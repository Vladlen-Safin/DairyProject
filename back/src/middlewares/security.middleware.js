import rateLimit from 'express-rate-limit';

// Общий лимит на все запросы
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов, попробуйте позже' },
});

// Жёсткий лимит именно на логин — защита от брутфорса паролей
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 попыток за 15 минут с одного IP
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут' },
});