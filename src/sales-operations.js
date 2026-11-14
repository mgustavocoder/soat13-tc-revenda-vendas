const saleSelect = `SELECT id, codigo, veiculo_id, veiculo_placa, cliente_id, cliente_cpf,
  data_venda, preco, status, last_error FROM vendas`

const activeStatuses = "'RESERVA_PROCESSANDO', 'AGUARDANDO_PAGAMENTO', 'PAGAMENTO_PROCESSANDO', 'PAGAMENTO_FALHOU'"

const permanentError = (message, status = 409) => {
  const error = new Error(message)
  error.permanent = true
  error.status = status
  return error
}

const normalizeServiceUrl = (baseUrl) => baseUrl.replace(/\/$/, '')

const createSalesOperations = ({
  db,
  clientesBaseUrl,
  veiculosBaseUrl,
  fetchImpl = globalThis.fetch
}) => {
  const requestService = async (baseUrl, path, options = {}) => {
    let response
    try {
      response = await fetchImpl(`${normalizeServiceUrl(baseUrl)}${path}`, {
        ...options,
        signal: options.signal || AbortSignal.timeout(10000)
      })
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
      error.permanent = [400, 404, 409].includes(response.status)
      throw error
    }
    return body
  }

  const getVenda = async (codigo) => {
    const [rows] = await db.execute(`${saleSelect} WHERE codigo = ? LIMIT 1`, [codigo])
    return rows[0]
  }

  const processReservation = async (codigo) => {
    const venda = await getVenda(codigo)
    if (!venda) throw permanentError('Reserva não encontrada.', 404)
    if (venda.status !== 'RESERVA_PROCESSANDO') return

    const [active] = await db.execute(
      `SELECT codigo FROM vendas WHERE veiculo_placa = ? AND codigo <> ?
       AND status IN (${activeStatuses}) LIMIT 1`,
      [venda.veiculo_placa, codigo]
    )
    if (active.length) throw permanentError('Este veículo já possui uma reserva ativa.')

    const cliente = await requestService(
      clientesBaseUrl,
      `/internal/clientes/${encodeURIComponent(venda.cliente_cpf)}`
    )
    const veiculo = await requestService(
      veiculosBaseUrl,
      `/internal/veiculos/${encodeURIComponent(venda.veiculo_placa)}`
    )

    if (veiculo.status === 'DISPONIVEL') {
      await requestService(
        veiculosBaseUrl,
        `/internal/veiculos/${encodeURIComponent(venda.veiculo_placa)}/status`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'RESERVADO' })
        }
      )
    } else if (veiculo.status !== 'RESERVADO') {
      throw permanentError('Veículo não está disponível para venda.')
    }

    const [result] = await db.execute(
      `UPDATE vendas
       SET veiculo_id = ?, cliente_id = ?, preco = ?, status = 'AGUARDANDO_PAGAMENTO', last_error = NULL
       WHERE codigo = ? AND status = 'RESERVA_PROCESSANDO'`,
      [veiculo.id, cliente.id, veiculo.preco, codigo]
    )
    if (!result.affectedRows) {
      const current = await getVenda(codigo)
      if (current?.status !== 'AGUARDANDO_PAGAMENTO') {
        throw new Error('A reserva foi alterada durante o processamento.')
      }
    }
  }

  const processPaymentConfirmation = async (codigo) => {
    const venda = await getVenda(codigo)
    if (!venda) throw permanentError('Venda não encontrada.', 404)
    if (venda.status !== 'PAGAMENTO_PROCESSANDO') return

    const veiculo = await requestService(
      veiculosBaseUrl,
      `/internal/veiculos/${encodeURIComponent(venda.veiculo_placa)}`
    )
    if (veiculo.status === 'RESERVADO') {
      await requestService(
        veiculosBaseUrl,
        `/internal/veiculos/${encodeURIComponent(venda.veiculo_placa)}/status`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'VENDIDO' })
        }
      )
    } else if (veiculo.status !== 'VENDIDO') {
      throw permanentError('O veículo não está reservado para esta venda.')
    }

    const [result] = await db.execute(
      `UPDATE vendas
       SET status = 'PAGAMENTO_CONFIRMADO', last_error = NULL
       WHERE codigo = ? AND status = 'PAGAMENTO_PROCESSANDO'`,
      [codigo]
    )
    if (!result.affectedRows) {
      const current = await getVenda(codigo)
      if (current?.status !== 'PAGAMENTO_CONFIRMADO') {
        throw new Error('O pagamento foi alterado durante o processamento.')
      }
    }
  }

  const processMessage = async (operation) => {
    if (!operation || !/^VEN-[A-F0-9]{8}$/.test(operation.codigo || '')) {
      throw new Error('Mensagem SQS inválida.')
    }
    if (operation.tipo === 'RESERVAR_VEICULO') {
      return processReservation(operation.codigo)
    }
    if (operation.tipo === 'CONFIRMAR_PAGAMENTO') {
      return processPaymentConfirmation(operation.codigo)
    }
    throw new Error('Tipo de operação SQS desconhecido.')
  }

  const failOperation = async (operation, message) => {
    if (!operation || !/^VEN-[A-F0-9]{8}$/.test(operation.codigo || '')) return

    const failures = {
      RESERVAR_VEICULO: ['RESERVA_FALHOU', 'RESERVA_PROCESSANDO'],
      CONFIRMAR_PAGAMENTO: ['PAGAMENTO_FALHOU', 'PAGAMENTO_PROCESSANDO']
    }
    const failure = failures[operation.tipo]
    if (!failure) return

    await db.execute(
      'UPDATE vendas SET status = ?, last_error = ? WHERE codigo = ? AND status = ?',
      [failure[0], String(message).slice(0, 500), operation.codigo, failure[1]]
    )
  }

  return { failOperation, getVenda, processMessage, requestService }
}

export { createSalesOperations }
