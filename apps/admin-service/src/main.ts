import dotenv from 'dotenv';
import path from 'path';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'apps/admin-service/.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'apps/E-Commerce-BG/.env') });

const router = require('./routers/admin.router').default;
const { getAdminDashboard } = require('./controllers/admin.controllers');

const app = express();
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.get('/', (req, res) => {
  res.send({ message: 'Welcome to admin-service!' });
});

app.get('/api/v1/admin/dashboard', getAdminDashboard);

const errorMiddleware: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error('Admin service error:', err);

  const status =
    typeof (err as { status?: unknown }).status === 'number'
      ? (err as { status: number }).status
      : 500;

  return res.status(status).json({
    status: 'error',
    message:
      process.env.NODE_ENV !== 'production'
        ? err.message
        : 'Something went wrong, please try again!',
  });
};

app.use("/api",router)
app.use(errorMiddleware);

const port = process.env.PORT || 8383;
const server = app.listen(port, () => {
  console.log(`Listening at http://localhost:${port}/api`);
});
server.on('error', console.error);
