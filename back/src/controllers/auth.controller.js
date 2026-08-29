import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';

export const login = async (req, res) => {
  try {
    const { login, password } = req.body;

    if (!login || !password) {
      return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }

    const result = await pool.query(
      'SELECT id, login, password_hash, role FROM users WHERE login = $1',
      [login]
    );

    // Одинаковый ответ и если юзера нет, и если пароль неверный —
    // чтобы нельзя было угадывать существующие логины (user enumeration)
    const genericError = () =>
      res.status(401).json({ error: 'Неверный логин или пароль' });

    if (result.rows.length === 0) return genericError();

    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) return genericError();

    const accessToken = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: process.env.JWT_ACCESS_EXPIRES }
    );

    const refreshToken = jwt.sign(
      { id: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES }
    );

    // Refresh-токен кладём в httpOnly cookie — недоступен из JS в браузере (защита от XSS-кражи токена)
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // только по HTTPS
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      accessToken,
      user: { id: user.id, login: user.login, role: user.role },
    });
  } catch (err) {
    console.error('Ошибка входа:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
};

export const refresh = async (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token) return res.status(401).json({ error: 'Нет refresh-токена' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);

    const result = await pool.query('SELECT id, role FROM users WHERE id = $1', [decoded.id]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Пользователь не найден' });

    const user = result.rows[0];
    const accessToken = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: process.env.JWT_ACCESS_EXPIRES }
    );

    res.json({ accessToken });
  } catch {
    res.status(401).json({ error: 'Недействительный refresh-токен' });
  }
};

export const logout = (req, res) => {
  res.clearCookie('refreshToken');
  res.json({ message: 'Вы вышли из системы' });
};