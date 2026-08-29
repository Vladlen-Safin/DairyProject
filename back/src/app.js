import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';
import morgan from 'morgan';

import authRoutes from './routes/auth.routes.js';
import { globalLimiter } from './middlewares/security.middleware.js';

const app = express();

// Безопасные HTTP-заголовки (CSP, X-Frame-Options, HSTS и т.д.)
app.use(helmet());
app.use(
  helmet.hsts({
    maxAge: 31536000, // форсим HTTPS год вперёд — защита от MITM через downgrade на HTTP
    includeSubDomains: true,
    preload: true,
  })
);

// CORS — разрешаем только конкретный фронтенд, не '*'
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:4200',
    credentials: true, // нужно для отправки cookie
  })
);

app.use(express.json({ limit: '10kb' })); // лимит размера тела запроса
app.use(cookieParser());
app.use(hpp()); // защита от дублирования параметров запроса
app.use(morgan('combined'));

app.use(globalLimiter);

app.use('/api/auth', authRoutes);

// Обработчик ошибок — не палим стектрейсы наружу
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Внутренняя ошибка сервера' : err.message,
  });
});

export default app;