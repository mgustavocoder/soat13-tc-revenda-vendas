import cors from 'cors'
import express from 'express'
import { xss } from 'express-xss-sanitizer'
import { Logger } from '../logger.js'
import { createHttpErrorHandler } from './http-error-handler.js'

const createApp = ({ vendaController, logger = new Logger() }) => {
  const app = express()
  app.use(cors())
  app.use(express.json())
  app.use(xss())
  app.disable('x-powered-by')

  app.get('/api/health', (req, res) => res.json({ status: 'healthy' }))

  app.get('/api/vendas', (req, res) => vendaController.listar(req, res))
  app.get('/api/vendas/:codigo', (req, res) => vendaController.buscarPorCodigo(req, res))
  app.post('/api/vendas/reservar', (req, res) => vendaController.reservar(req, res))
  app.post('/api/vendas/:codigo/confirmar-pagamento', (req, res) => vendaController.confirmarPagamento(req, res))
  app.post('/api/vendas/:codigo/cancelar', (req, res) => vendaController.cancelar(req, res))

  app.use(createHttpErrorHandler({ logger }))
  return app
}

export { createApp }
