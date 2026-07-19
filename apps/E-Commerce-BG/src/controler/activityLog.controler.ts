import { NextFunction, Request, Response } from "express";
import prisma from "../packages/libs/prisma";
import { ValidationError } from "../packages/error-handler";
import { createActivityLog } from "../utils/activityLogger";

const activityLogModel = () => (prisma as any).activity_logs;

const allowedSortFields = new Set([
  "createdAt",
  "updatedAt",
  "userName",
  "userRole",
  "module",
  "action",
  "status",
  "requestMethod",
  "endpoint",
]);

const normalizeText = (value: unknown, maxLength = 500) => {
  if (typeof value !== "string") {
    return undefined;
  }

  return value.trim().slice(0, maxLength);
};

const getPageNumber = (value: unknown, fallback: number) => {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.floor(numberValue)
    : fallback;
};

const getActivityLogId = (value: unknown) => {
  const id = normalizeText(value, 80);

  if (!id || !/^[a-f\d]{24}$/i.test(id)) {
    throw new ValidationError("Invalid activity log id.");
  }

  return id;
};

const buildActivityLogWhere = (query: any) => {
  const search = normalizeText(query.search, 160);
  const userRole = normalizeText(query.userRole, 40);
  const module = normalizeText(query.module, 80);
  const action = normalizeText(query.action, 100);
  const status = normalizeText(query.status, 20);
  const startDate = normalizeText(query.startDate, 40);
  const endDate = normalizeText(query.endDate, 40);
  const where: any = {};
  const andConditions: any[] = [];

  if (search) {
    andConditions.push({
      OR: [
        { userName: { contains: search } },
        { userRole: { contains: search } },
        { action: { contains: search } },
        { module: { contains: search } },
        { description: { contains: search } },
        { targetId: { contains: search } },
        { targetName: { contains: search } },
        { ipAddress: { contains: search } },
        { endpoint: { contains: search } },
      ],
    });
  }

  if (userRole) where.userRole = userRole;
  if (module) where.module = module;
  if (action) where.action = action;
  if (status) where.status = status;

  if (startDate || endDate) {
    where.createdAt = {};

    if (startDate) {
      const date = new Date(startDate);
      if (!Number.isNaN(date.getTime())) where.createdAt.gte = date;
    }

    if (endDate) {
      const date = new Date(endDate);
      if (!Number.isNaN(date.getTime())) {
        date.setHours(23, 59, 59, 999);
        where.createdAt.lte = date;
      }
    }
  }

  if (andConditions.length > 0) {
    where.AND = andConditions;
  }

  return where;
};

const mapActivityLog = (log: any) => ({
  id: log.id,
  userId: log.userId || "",
  userName: log.userName || "N/A",
  userRole: log.userRole || "System",
  action: log.action || "N/A",
  module: log.module || "N/A",
  description: log.description || "N/A",
  targetId: log.targetId || "",
  targetName: log.targetName || "",
  ipAddress: log.ipAddress || "N/A",
  userAgent: log.userAgent || "N/A",
  requestMethod: log.requestMethod || "N/A",
  endpoint: log.endpoint || "N/A",
  status: log.status || "N/A",
  createdAt: log.createdAt,
  updatedAt: log.updatedAt,
});

export const getActivityLogs = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const model = activityLogModel();

    if (!model) {
      return res.status(200).json({
        success: true,
        logs: [],
        pagination: {
          page: 1,
          limit: 10,
          totalLogs: 0,
          totalPages: 1,
        },
      });
    }

    const page = getPageNumber(req.query.page, 1);
    const limit = Math.min(getPageNumber(req.query.limit, 10), 100);
    const sortBy = allowedSortFields.has(String(req.query.sortBy || ""))
      ? String(req.query.sortBy)
      : "createdAt";
    const sortOrder = req.query.sortOrder === "asc" ? "asc" : "desc";
    const where = buildActivityLogWhere(req.query);
    const [logs, totalLogs] = await Promise.all([
      model.findMany({
        where,
        orderBy: {
          [sortBy]: sortOrder,
        },
        skip: (page - 1) * limit,
        take: limit,
      }),
      model.count({ where }),
    ]);

    return res.status(200).json({
      success: true,
      logs: logs.map(mapActivityLog),
      pagination: {
        page,
        limit,
        totalLogs,
        total: totalLogs,
        totalPages: Math.max(1, Math.ceil(totalLogs / limit)),
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const getActivityLog = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const id = getActivityLogId(req.params.logId);
    const log = await activityLogModel()?.findUnique({
      where: {
        id,
      },
    });

    if (!log) {
      return res.status(404).json({
        success: false,
        message: "Activity log not found.",
      });
    }

    return res.status(200).json({
      success: true,
      log: mapActivityLog(log),
    });
  } catch (error) {
    return next(error);
  }
};

export const createActivityLogEntry = async (
  req: any,
  res: Response,
  next: NextFunction
) => {
  try {
    const action = normalizeText(req.body?.action, 100);
    const module = normalizeText(req.body?.module, 80);
    const description = normalizeText(req.body?.description, 1000);

    if (!action || !module || !description) {
      return next(new ValidationError("Action, module, and description are required."));
    }

    const admin = req.admin || {};
    const log = await createActivityLog({
      userId: normalizeText(req.body?.userId, 80) || admin.id,
      userName: normalizeText(req.body?.userName, 120) || admin.name || admin.email,
      userRole: (normalizeText(req.body?.userRole, 40) as any) || "Admin",
      action,
      module,
      description,
      targetId: normalizeText(req.body?.targetId, 120),
      targetName: normalizeText(req.body?.targetName, 180),
      ipAddress: req.ip || req.socket?.remoteAddress || "",
      userAgent: String(req.headers["user-agent"] || ""),
      requestMethod: req.method,
      endpoint: req.originalUrl || req.url,
      status: req.body?.status === "Failed" ? "Failed" : "Success",
    });

    return res.status(201).json({
      success: true,
      log: mapActivityLog(log),
    });
  } catch (error) {
    return next(error);
  }
};

export const updateActivityLogEntry = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const id = getActivityLogId(req.params.logId);
    const data: any = {};

    [
      "userId",
      "userName",
      "userRole",
      "action",
      "module",
      "description",
      "targetId",
      "targetName",
      "ipAddress",
      "userAgent",
      "requestMethod",
      "endpoint",
      "status",
    ].forEach((field) => {
      if (field in req.body) {
        data[field] = normalizeText(req.body[field], field === "description" ? 1000 : 180) || null;
      }
    });

    const log = await activityLogModel()?.update({
      where: {
        id,
      },
      data,
    });

    return res.status(200).json({
      success: true,
      log: mapActivityLog(log),
    });
  } catch (error) {
    return next(error);
  }
};

export const deleteActivityLogEntry = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const id = getActivityLogId(req.params.logId);

    await activityLogModel()?.delete({
      where: {
        id,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Activity log deleted successfully.",
    });
  } catch (error) {
    return next(error);
  }
};
