import { VendaRepository } from '../../application/gateways/venda-repository.js'
import { Venda } from '../../domain/entities/venda.js'
import { DuplicateResourceError } from '../../domain/errors/duplicate-resource-error.js'

const SELECT_VENDA = `SELECT id, codigo, veiculo_id, veiculo_placa, cliente_id, cliente_cpf,
  data_venda, preco, status, last_error FROM vendas`

const toVenda = (row) => new Venda({
  id: row.id,
  codigo: row.codigo,
  veiculoId: row.veiculo_id ?? null,
  veiculoPlaca: row.veiculo_placa,
  clienteId: row.cliente_id ?? null,
  clienteCpf: row.cliente_cpf,
  dataVenda: row.data_venda ?? null,
  preco: row.preco == null ? null : Number(row.preco),
  status: row.status,
  ultimoErro: row.last_error ?? null
})

class MysqlVendaRepository extends VendaRepository {
  constructor(db) {
    super()
    this.db = db
  }

  async listar() {
    const [rows] = await this.db.execute(`${SELECT_VENDA} ORDER BY id`)
    return rows.map(toVenda)
  }

  async buscarPorCodigo(codigo) {
    const [rows] = await this.db.execute(`${SELECT_VENDA} WHERE codigo = ? LIMIT 1`, [codigo])
    return rows[0] ? toVenda(rows[0]) : undefined
  }

  async criar(venda) {
    try {
      const [result] = await this.db.execute(
        `INSERT INTO vendas (codigo, veiculo_placa, cliente_id, cliente_cpf, status)
         VALUES (?, ?, ?, ?, ?)`,
        [venda.codigo, venda.veiculoPlaca, venda.clienteId, venda.clienteCpf, venda.status]
      )
      venda.id = result?.insertId ?? null
      return venda
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        throw new DuplicateResourceError('Já existe uma venda ativa com este veículo.')
      }
      throw error
    }
  }

  async atualizar(venda, statusAnterior) {
    const [result] = await this.db.execute(
      `UPDATE vendas
       SET veiculo_id = ?, cliente_id = ?, preco = ?, status = ?, last_error = ?
       WHERE codigo = ? AND status = ?`,
      [venda.veiculoId, venda.clienteId, venda.preco, venda.status, venda.ultimoErro, venda.codigo, statusAnterior]
    )
    return result.affectedRows > 0
  }
}

export { MysqlVendaRepository }
