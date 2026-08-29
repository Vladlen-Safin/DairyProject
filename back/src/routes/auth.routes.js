import { Router } from 'express';
import { body } from 'express-validator';
import { login, refresh, logout } from '../controllers/auth.controller.js';
import { loginLimiter } from '../middlewares/security.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';

const router = Router();

router.post(
  '/login',
  loginLimiter,
  [
    body('login').trim().notEmpty().escape(),
    body('password').notEmpty().isLength({ min: 4 }),
  ],
  validate,
  login
);

router.post('/refresh', refresh);
router.post('/logout', logout);

export default router;