class Cpf {
  constructor(valor) {
    this.valor = valor
  }

  static normalizar(cpf) {
    return String(cpf ?? '').replace(/\D/g, '')
  }

  static isValid(cpf) {
    return Cpf.normalizar(cpf).length === 11
  }

  static criar(cpf) {
    return new Cpf(Cpf.normalizar(cpf))
  }

  getValor() {
    return this.valor
  }
}

export { Cpf }
