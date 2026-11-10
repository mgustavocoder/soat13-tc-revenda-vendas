import { randomBytes } from 'node:crypto'
import cors from 'cors'
import express from 'express'
import { xss } from 'express-xss-sanitizer'
import { createPool } from 'mysql2/promise'

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
  fetchImpl = globalThis.fetch
} = {}) => {
  const app = express()
  app.use(cors())
  app.use(express.json())
  app.use(xss())
  app.disable('x-powered-by')

  const requestService = async (baseUrl, path, options = {}) => {
    let response
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, options)
    } catch (cause) {
      const error = new Error('Serviço dependente indisponível.')
      error.status = 503
      error.cause = cause
      throw error
    }

    let body
    try {
      body = await response.json()
    } catch (cause) {
      const error = new Error('Resposta inválida de serviço dependente.')
      error.status = 502
      error.cause = cause
      throw error
    }
    if (!response.ok) {
      const error = new Error(body.message || 'Falha ao consultar serviço dependente.')
      error.status = [400, 404, 409].includes(response.status) ? response.status : 502
      throw error
    }
    return body
  }

  const getVenda = async (codigo) => {
    const [rows] = await db.execute(
      'SELECT id, codigo, veiculo_id, veiculo_placa, cliente_id, cliente_cpf, data_venda, preco, status FROM vendas WHERE codigo = ? LIMIT 1',
      [codigo]
    )
    return rows[0]
  }

  const toPublicSale = (venda) => ({
    codigo: venda.codigo,
    veiculoPlaca: venda.veiculo_placa,
    clienteCpf: venda.cliente_cpf,
    preco: Number(venda.preco),
    dataVenda: venda.data_venda,
    status: venda.status
  })

  app.get('/api/health', (req, res) => res.json({ status: 'healthy' }))

  app.get('/api/vendas', async (req, res) => {
    const [rows] = await db.execute(
      'SELECT id, codigo, veiculo_id, veiculo_placa, cliente_id, cliente_cpf, data_venda, preco, status FROM vendas ORDER BY id'
    )
    return res.status(200).json(rows.map(toPublicSale))
  })

  app.post('/api/vendas/reservar', async (req, res) => {
    const placa = normalizePlaca(req.body?.veiculoPlaca ?? req.body?.placa)
    const cpf = normalizeCpf(req.body?.clienteCpf)
    if (!isValidPlaca(placa) || !isValidCpf(cpf)) {
      return res.status(400).json({ message: 'Informe uma placa e um CPF válidos.' })
    }

    const cliente = await requestService(clientesBaseUrl, `/internal/clientes/${encodeURIComponent(cpf)}`)
    const veiculo = await requestService(veiculosBaseUrl, `/internal/veiculos/${encodeURIComponent(placa)}`)
    if (veiculo.status !== 'DISPONIVEL') {
      return res.status(409).json({ message: 'Veículo não está disponível para venda.' })
    }

    const [active] = await db.execute(
      "SELECT codigo FROM vendas WHERE veiculo_placa = ? AND status = 'AGUARDANDO_PAGAMENTO' LIMIT 1",
      [placa]
    )
    if (active.length) return res.status(409).json({ message: 'Este veículo já possui uma reserva ativa.' })

    await requestService(veiculosBaseUrl, `/internal/veiculos/${encodeURIComponent(placa)}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'RESERVADO' })
    })

    const codigo = generateCode()
    try {
      await db.execute(
        'INSERT INTO vendas (codigo, veiculo_id, veiculo_placa, cliente_id, cliente_cpf, preco, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [codigo, veiculo.id, placa, cliente.id, cpf, veiculo.preco, 'AGUARDANDO_PAGAMENTO']
      )
    } catch (error) {
      try {
        await requestService(veiculosBaseUrl, `/internal/veiculos/${encodeURIComponent(placa)}/status`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'DISPONIVEL' })
        })
      } catch (compensationError) {
        console.error('Falha ao liberar veículo após erro ao criar venda:', compensationError)
      }
      throw error
    }

    const venda = await getVenda(codigo)
    return res.status(201).json({
      ...toPublicSale(venda),
      veiculo: { ...veiculo, status: 'RESERVADO' },
      cliente: { nome: cliente.nome, cpf: cliente.cpf, email: cliente.email }
    })
  })

  const changeSaleState = async (req, res, status, vehicleStatus) => {
    const codigo = String(req.params.codigo || '').trim().toUpperCase()
    if (!/^VEN-[A-F0-9]{8}$/.test(codigo)) {
      return res.status(400).json({ message: 'Código da venda inválido.' })
    }
    const venda = await getVenda(codigo)
    if (!venda) return res.status(404).json({ message: 'Venda não encontrada.' })
    if (venda.status === 'CANCELADA') {
      return res.status(409).json({ message: status === 'CANCELADA'
        ? 'Venda já cancelada.'
        : 'Não é possível confirmar pagamento de uma venda cancelada.' })
    }
    if (venda.status === 'PAGAMENTO_CONFIRMADO') {
      return res.status(409).json({ message: status === 'CANCELADA'
        ? 'Não é possível cancelar uma venda já confirmada.'
        : 'Pagamento já confirmado para esta venda.' })
    }

    const [result] = await db.execute(
      "UPDATE vendas SET status = ? WHERE codigo = ? AND status = 'AGUARDANDO_PAGAMENTO'",
      [status, codigo]
    )
    if (!result.affectedRows) return res.status(409).json({ message: 'A venda foi alterada por outra operação.' })

    try {
      await requestService(
        veiculosBaseUrl,
        `/internal/veiculos/${encodeURIComponent(venda.veiculo_placa)}/status`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: vehicleStatus })
        }
      )
    } catch (error) {
      try {
        await db.execute(
          "UPDATE vendas SET status = 'AGUARDANDO_PAGAMENTO' WHERE codigo = ? AND status = ?",
          [codigo, status]
        )
      } catch (compensationError) {
        console.error('Falha ao reverter status da venda após erro na API de veículos:', compensationError)
      }
      throw error
    }

    const vendaAtualizada = await getVenda(codigo)
    return res.status(200).json(toPublicSale(vendaAtualizada))
  }

  app.post('/api/vendas/:codigo/cancelar', async (req, res) =>
    changeSaleState(req, res, 'CANCELADA', 'DISPONIVEL'))
  app.post('/api/vendas/:codigo/confirmar-pagamento', async (req, res) =>
    changeSaleState(req, res, 'PAGAMENTO_CONFIRMADO', 'VENDIDO'))

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
