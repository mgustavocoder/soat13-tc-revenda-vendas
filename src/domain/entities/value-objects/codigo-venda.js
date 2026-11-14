import { randomBytes } from 'node:crypto'

const CODIGO_PATTERN = /^VEN-[A-F0-9]{8}$/

class CodigoVenda {
  static normalizar(codigo) {
    return String(codigo ?? '').trim().toUpperCase()
  }

  static isValid(codigo) {
    return CODIGO_PATTERN.test(CodigoVenda.normalizar(codigo))
  }

  static gerar() {
    return `VEN-${randomBytes(4).toString('hex').toUpperCase()}`
  }
}

export { CodigoVenda }
