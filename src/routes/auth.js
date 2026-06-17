const express = require('express');
const prisma = require('../config/prisma');
const { hashPassword, verifyPassword } = require('../utils/password');
const { generateToken } = require('../utils/jwt');
const { authenticate } = require('../middleware/authMiddleware');
const { validateRegister, validateLogin } = require('../validations/authValidation');

const router = express.Router();

router.post('/register', validateRegister, async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ error: '该邮箱已被注册' });
    }

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const token = generateToken({ userId: user.id, role: user.role });

    res.status(201).json({
      user,
      token,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/login', validateLogin, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({ error: '邮箱或密码错误' });
    }

    if (!user.isActive) {
      return res.status(401).json({ error: '账户已被禁用' });
    }

    const isValidPassword = await verifyPassword(password, user.passwordHash);

    if (!isValidPassword) {
      return res.status(401).json({ error: '邮箱或密码错误' });
    }

    const token = generateToken({ userId: user.id, role: user.role });

    const userResponse = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    res.json({
      user: userResponse,
      token,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
