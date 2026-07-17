import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
import { logger } from './config/logger.js';
import { getRedisClient, disconnectRedis } from './config/redis.js';
import authRoutes from './routes/auth.js';
import transactionRoutes from './routes/transactions.js';
import budgetRoutes from './routes/budgets.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Security headers
app.use(helmet());

// Response compression — reduces payload size over the wire
// Uses gzip/brotli. Threshold set to 512 bytes to skip tiny responses.
app.use(compression({ threshold: 512 }));

// CORS config
const allowedOrigins = [
  'http://localhost:5173',
  'https://expense-tracker-app-react-node-expr.vercel.app',
  process.env.CLIENT_URL
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like postman/curl)
    if (!origin) return callback(null, true);
    
    const isAllowed = allowedOrigins.some(allowed => {
      return allowed.replace(/\/$/, '') === origin.replace(/\/$/, '');
    });

    if (isAllowed) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// Request logging — only in development (at 1M RPS this would kill throughput)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    logger.debug(`${req.method} ${req.url}`);
    next();
  });
}

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/budgets', budgetRoutes);

// Health check endpoint (no rate limit, no auth — used by load balancers)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date(),
    pid: process.pid,
    uptime: process.uptime(),
    memory: process.memoryUsage().rss,
  });
});

// Start server
const startServer = async () => {
  try {
    const isServerless = !!(
      process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.FUNCTION_NAME
    );

    const mongooseOptions = {
      serverSelectionTimeoutMS: 5000,
    };

    // Only apply heavy pooling options in non-serverless environments (like standalone VMs/containers)
    // to avoid connection exhaustion and long cold start times on Vercel.
    if (!isServerless) {
      mongooseOptions.maxPoolSize = 50;
      mongooseOptions.minPoolSize = 10;
      mongooseOptions.maxIdleTimeMS = 30000;
      mongooseOptions.socketTimeoutMS = 45000;
    }

    // MongoDB connection
    await mongoose.connect(process.env.MONGODB_URI, mongooseOptions);
    logger.info('Successfully connected to MongoDB');

    // Initialize Redis connection (non-blocking — app works without it)
    try {
      getRedisClient();
    } catch (err) {
      logger.warn({ err }, 'Redis initialization failed — running without cache');
    }

    const server = app.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT} (PID: ${process.pid})`);
    });

    // Graceful shutdown — critical for zero-downtime deployments (skipped in serverless environments)
    if (!isServerless) {
      const gracefulShutdown = async (signal) => {
        logger.info(`${signal} received — shutting down gracefully...`);

        // Stop accepting new connections
        server.close(async () => {
          logger.info('HTTP server closed');

          // Close database connections
          try {
            await mongoose.connection.close();
            logger.info('MongoDB connection closed');
          } catch (err) {
            logger.error({ err }, 'Error closing MongoDB');
          }

          // Close Redis connection
          try {
            await disconnectRedis();
            logger.info('Redis connection closed');
          } catch (err) {
            logger.error({ err }, 'Error closing Redis');
          }

          process.exit(0);
        });

        // Force exit if graceful shutdown takes too long
        setTimeout(() => {
          logger.error('Graceful shutdown timed out — forcing exit');
          process.exit(1);
        }, 10000);
      };

      try {
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
      } catch (signalErr) {
        logger.warn({ err: signalErr }, 'Could not register process signal listeners');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
};

// Export app and default for Vercel / serverless runtime compatibility
export { app, startServer };
export default app;

// If running directly (not via cluster), start immediately
const isDirectRun = !process.env.IS_CLUSTER_WORKER;
if (isDirectRun) {
  startServer();
}
