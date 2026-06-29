import nodemailer from "nodemailer";
import { AppError } from "../packages/error-handler";

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

const isSmtpConfigured = () =>
  process.env.SMTP_MAIL &&
  process.env.SMTP_MAIL !== "your-email@gmail.com" &&
  process.env.SMTP_PASSWORD &&
  process.env.SMTP_PASSWORD !== "your-gmail-app-password";

let devTransporter: nodemailer.Transporter | null = null;

const getDevTransporter = async (): Promise<nodemailer.Transporter> => {
  if (!devTransporter) {
    const account = await nodemailer.createTestAccount();
    devTransporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: { user: account.user, pass: account.pass },
    });
    console.log("\n[DEV] Ethereal test account created:", account.user);
  }
  return devTransporter;
};

export const sendEmail = async ({ to, subject, html }: SendEmailOptions) => {
  try {
    let transporter: nodemailer.Transporter;
    let fromAddress: string;
    const company = process.env.COMPANY_NAME || "E-Shop";

    if (isSmtpConfigured()) {
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: false,
        auth: {
          user: process.env.SMTP_MAIL,
          pass: process.env.SMTP_PASSWORD,
        },
      });
      fromAddress = `"${company}" <${process.env.SMTP_MAIL}>`;
    } else {
      transporter = await getDevTransporter();
      fromAddress = `"${company} [DEV]" <dev@ethereal.email>`;
    }

    const info = await transporter.sendMail({ from: fromAddress, to, subject, html });

    if (!isSmtpConfigured()) {
      console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("[DEV] Email NOT sent to real inbox (SMTP not configured)");
      console.log("[DEV] View the captured email with OTP here:");
      console.log("[DEV]", nodemailer.getTestMessageUrl(info));
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    }
  } catch (err: any) {
    throw new AppError(`Failed to send email: ${err.message}`, 500);
  }
};
