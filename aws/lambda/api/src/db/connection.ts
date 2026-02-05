import { Pool, PoolClient } from 'pg';
import { getDBCredentials } from '../utils/secrets';

let pool: Pool | null = null;

export async function getPool(): Promise<Pool> {
  if (pool) {
    return pool;
  }

  const credentials = await getDBCredentials();

  pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: credentials.username,
    password: credentials.password,
    max: 10, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    ssl: {
      rejectUnauthorized: false, // For AWS RDS
    },
  });

  // Test the connection
  try {
    const client = await pool.connect();
    console.log('Database connected successfully');
    client.release();
  } catch (error) {
    console.error('Database connection error:', error);
    throw error;
  }

  return pool;
}

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const pool = await getPool();
  const result = await pool.query(text, params);
  return result.rows;
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

export async function getClient(): Promise<PoolClient> {
  const pool = await getPool();
  return await pool.connect();
}

// Utility functions for common operations
export async function insert<T = any>(
  table: string,
  data: Record<string, any>
): Promise<T> {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const columns = keys.join(', ');

  const text = `
    INSERT INTO ${table} (${columns})
    VALUES (${placeholders})
    RETURNING *
  `;

  const result = await queryOne<T>(text, values);
  if (!result) {
    throw new Error('Insert failed');
  }
  return result;
}

export async function update<T = any>(
  table: string,
  id: string,
  data: Record<string, any>
): Promise<T | null> {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');

  const text = `
    UPDATE ${table}
    SET ${setClause}, updated_at = CURRENT_TIMESTAMP
    WHERE id = $${keys.length + 1}
    RETURNING *
  `;

  return await queryOne<T>(text, [...values, id]);
}

export async function deleteById(table: string, id: string): Promise<boolean> {
  const text = `DELETE FROM ${table} WHERE id = $1`;
  const pool = await getPool();
  const result = await pool.query(text, [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function findById<T = any>(table: string, id: string): Promise<T | null> {
  const text = `SELECT * FROM ${table} WHERE id = $1`;
  return await queryOne<T>(text, [id]);
}

export async function findAll<T = any>(
  table: string,
  where?: Record<string, any>,
  orderBy?: string
): Promise<T[]> {
  let text = `SELECT * FROM ${table}`;
  const params: any[] = [];

  if (where && Object.keys(where).length > 0) {
    const conditions = Object.keys(where).map((key, i) => {
      params.push(where[key]);
      return `${key} = $${i + 1}`;
    });
    text += ` WHERE ${conditions.join(' AND ')}`;
  }

  if (orderBy) {
    text += ` ORDER BY ${orderBy}`;
  }

  return await query<T>(text, params);
}
