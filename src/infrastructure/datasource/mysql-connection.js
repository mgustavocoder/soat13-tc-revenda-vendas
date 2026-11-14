import { createPool } from 'mysql2/promise'

const createMysqlPool = ({ connectionLimit = 10 } = {}) => createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'vendas_db',
  waitForConnections: true,
  connectionLimit
})

export { createMysqlPool }
