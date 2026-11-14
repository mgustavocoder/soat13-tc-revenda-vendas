import { randomBytes } from 'node:crypto'
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import cors from 'cors'
import express from 'express'
import { xss } from 'express-xss-sanitizer'
import { createPool } from 'mysql2/promise'
import { createSalesOperations } from './sales-operations.js'

const normalizePlaca = (placa) => String(placa || '').replace(/[^A-Z0-9]/gi, '').toUpperCase()
const isValidPlaca = (placa) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)
const normalizeCpf = (cpf) => String(cpf || '').replace(/\D/g, '')
const isValidCpf = (cpf) => cpf.length === 11
const generateCode = () => `VEN-${randomBytes(4).toString('hex').toUpperCase()}`

const createApp = ({
  db = createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'vendas_db',
    waitForConnections: true,
    connectionLimit: 10
  }),
  clientesBaseUrl = process.env.CLIENTES_SERVICE_URL || 'http://localhost:3001',
  veiculosBaseUrl = process.env.VEICULOS_SERVICE_URL || 'http://localhost:3002',
  sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' }),
  queueUrl = process.env.SQS_QUEUE_URL,
  fetchImpl = globalThis.fetch
} = {}) => {
  const app = express()
  app.use(cors())
  app.use(express.json())
  app.use(xss())
  app.disable('x-powered-by')

  const operations = createSalesOperations({
    db,
    clientesBaseUrl,
    veiculosBaseUrl,
    fetchImpl
  })

  const enqueueOperation = async (tipo, codigo) => {
    if (!queueUrl) {
      const error = new Error('Fila de operações não configurada.')
      error.status = 503
      throw error
    }

    try {
      return await sqsClient.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ tipo, codigo })
      }))
    } catch (cause) {
      console.error(`Falha ao enfileirar a operação ${tipo}:`, cause)
      const error = new Error('Fila de operações indisponível.')
      error.status = 503
      error.cause = cause
      throw error
    }
  }

  const toPublicSale = (venda) => ({
    codigo: venda.codigo,
    veiculoPlaca: venda.veiculo_placa,
    clienteCpf: venda.cliente_cpf,
    preco: venda.preco == null ? null : Number(venda.preco),
    dataVenda: venda.data_venda,
    status: venda.status,
    ...(venda.last_error ? { erro: venda.last_error } : {})
  })

  app.get('/api/health', (req, res) => res.json({ status: 'healthy' }))

  app.get('/api/vendas', async (req, res) => {
    const [rows] = await db.execute(
      'SELECT id, codigo, veiculo_id, veiculo_placa, cliente_id, cliente_cpf, data_venda, preco, status, last_error FROM vendas ORDER BY id'
    )
    return res.status(200).json(rows.map(toPublicSale))
  })

  app.get('/api/vendas/:codigo', async (req, res) => {
    const codigo = String(req.params.codigo || '').trim().toUpperCase()
    if (!/^VEN-[A-F0-9]{8}$/.test(codigo)) {
      return res.status(400).json({ message: 'Código da venda inválido.' })
    }
    const venda = await operations.getVenda(codigo)
    if (!venda) return res.status(404).json({ message: 'Venda não encontrada.' })
    return res.status(200).json(toPublicSale(venda))
  })

  app.post('/api/vendas/reservar', async (req, res) => {
    const placa = normalizePlaca(req.body?.veiculoPlaca ?? req.body?.placa)
    const cpf = normalizeCpf(req.body?.clienteCpf)
    if (!isValidPlaca(placa) || !isValidCpf(cpf)) {
      return res.status(400).json({ message: 'Informe uma placa e um CPF válidos.' })
    }

    const codigo = generateCode()
    await db.execute(
      `INSERT INTO vendas (codigo, veiculo_placa, cliente_cpf, status)
       VALUES (?, ?, ?, 'RESERVA_PROCESSANDO')`,
      [codigo, placa, cpf]
    )

    try {
      await enqueueOperation('RESERVAR_VEICULO', codigo)
    } catch (error) {
      try {
        await db.execute(
          `UPDATE vendas SET status = 'RESERVA_FALHOU', last_error = ?
           WHERE codigo = ? AND status = 'RESERVA_PROCESSANDO'`,
          ['Não foi possível iniciar a reserva.', codigo]
        )
      } catch (updateError) {
        console.error('Falha ao registrar erro ao enfileirar a reserva:', updateError)
      }
      throw error
    }

    const venda = await operations.getVenda(codigo)
    return res.status(202).json({
      ...toPublicSale(venda),
      statusUrl: `/api/vendas/${codigo}`
    })
  })

  const changeSaleState = async (req, res) => {
    const codigo = String(req.params.codigo || '').trim().toUpperCase()
    if (!/^VEN-[A-F0-9]{8}$/.test(codigo)) {
      return res.status(400).json({ message: 'Código da venda inválido.' })
    }
    const venda = await operations.getVenda(codigo)
    if (!venda) return res.status(404).json({ message: 'Venda não encontrada.' })
    if (venda.status === 'CANCELADA') {
      return res.status(409).json({ message: 'Venda já cancelada.' })
    }
    if (venda.status === 'PAGAMENTO_CONFIRMADO') {
      return res.status(409).json({ message: 'Não é possível cancelar uma venda já confirmada.' })
    }
    if (!['AGUARDANDO_PAGAMENTO', 'PAGAMENTO_FALHOU'].includes(venda.status)) {
      return res.status(409).json({ message: 'A venda não pode ser cancelada enquanto está sendo processada.' })
    }

    const [result] = await db.execute(
      'UPDATE vendas SET status = ?, last_error = NULL WHERE codigo = ? AND status = ?',
      ['CANCELADA', codigo, venda.status]
    )
    if (!result.affectedRows) return res.status(409).json({ message: 'A venda foi alterada por outra operação.' })

    try {
      await operations.requestService(
        veiculosBaseUrl,
        `/internal/veiculos/${encodeURIComponent(venda.veiculo_placa)}/status`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'DISPONIVEL' })
        }
      )
    } catch (error) {
      try {
        await db.execute(
          'UPDATE vendas SET status = ?, last_error = NULL WHERE codigo = ? AND status = ?',
          [venda.status, codigo, 'CANCELADA']
        )
      } catch (compensationError) {
        console.error('Falha ao reverter status da venda após erro na API de veículos:', compensationError)
      }
      throw error
    }

    const vendaAtualizada = await operations.getVenda(codigo)
    return res.status(200).json(toPublicSale(vendaAtualizada))
  }

  app.post('/api/vendas/:codigo/cancelar', changeSaleState)
  app.post('/api/vendas/:codigo/confirmar-pagamento', async (req, res) => {
    const codigo = String(req.params.codigo || '').trim().toUpperCase()
    if (!/^VEN-[A-F0-9]{8}$/.test(codigo)) {
      return res.status(400).json({ message: 'Código da venda inválido.' })
    }
    const venda = await operations.getVenda(codigo)
    if (!venda) return res.status(404).json({ message: 'Venda não encontrada.' })
    if (venda.status === 'CANCELADA') {
      return res.status(409).json({ message: 'Não é possível confirmar pagamento de uma venda cancelada.' })
    }
    if (venda.status === 'PAGAMENTO_CONFIRMADO') {
      return res.status(409).json({ message: 'Pagamento já confirmado para esta venda.' })
    }
    if (venda.status === 'PAGAMENTO_PROCESSANDO') {
      return res.status(409).json({ message: 'A confirmação do pagamento já está em processamento.' })
    }
    if (!['AGUARDANDO_PAGAMENTO', 'PAGAMENTO_FALHOU'].includes(venda.status)) {
      return res.status(409).json({ message: 'A reserva ainda não está pronta para confirmação do pagamento.' })
    }

    const [result] = await db.execute(
      'UPDATE vendas SET status = ?, last_error = NULL WHERE codigo = ? AND status = ?',
      ['PAGAMENTO_PROCESSANDO', codigo, venda.status]
    )
    if (!result.affectedRows) return res.status(409).json({ message: 'A venda foi alterada por outra operação.' })

    try {
      await enqueueOperation('CONFIRMAR_PAGAMENTO', codigo)
    } catch (error) {
      try {
        await db.execute(
          'UPDATE vendas SET status = ? WHERE codigo = ? AND status = ?',
          [venda.status, codigo, 'PAGAMENTO_PROCESSANDO']
        )
      } catch (updateError) {
        console.error('Falha ao restaurar a venda após erro ao enfileirar o pagamento:', updateError)
      }
      throw error
    }

    const vendaAtualizada = await operations.getVenda(codigo)
    return res.status(202).json({
      ...toPublicSale(vendaAtualizada),
      statusUrl: `/api/vendas/${codigo}`
    })
  })

  app.use((error, req, res, next) => {
    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Já existe uma venda ativa com este veículo.' })
    }
    if (error?.status) return res.status(error.status).json({ message: error.message })
    console.error('Falha no serviço de vendas:', error)
    return res.status(500).json({ message: 'Erro interno no serviço de vendas.' })
  })

  return app
}

export { createApp }
