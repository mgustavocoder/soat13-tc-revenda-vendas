CREATE TABLE IF NOT EXISTS vendas (
    id INT NOT NULL AUTO_INCREMENT,
    codigo VARCHAR(20) NOT NULL UNIQUE,
    veiculo_id INT NULL,
    veiculo_placa VARCHAR(10) NOT NULL,
    cliente_id INT NULL,
    cliente_cpf VARCHAR(14) NOT NULL,
    data_venda TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    preco DECIMAL(10, 2) NULL,
    status ENUM(
        'RESERVA_PROCESSANDO',
        'RESERVA_FALHOU',
        'AGUARDANDO_PAGAMENTO',
        'PAGAMENTO_PROCESSANDO',
        'PAGAMENTO_FALHOU',
        'CANCELADA',
        'PAGAMENTO_CONFIRMADO'
    ) NOT NULL DEFAULT 'AGUARDANDO_PAGAMENTO',
    last_error VARCHAR(500) NULL,
    active_veiculo_placa VARCHAR(10)
        GENERATED ALWAYS AS (
            CASE
                WHEN status IN (
                    'RESERVA_PROCESSANDO',
                    'AGUARDANDO_PAGAMENTO',
                    'PAGAMENTO_PROCESSANDO',
                    'PAGAMENTO_FALHOU'
                ) THEN veiculo_placa
                ELSE NULL
            END
        ) STORED,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_vendas_veiculo_status (veiculo_placa, status),
    UNIQUE KEY uq_vendas_veiculo_ativo (active_veiculo_placa)
);

DROP PROCEDURE IF EXISTS migrate_vendas_async_operations;
DELIMITER //
CREATE PROCEDURE migrate_vendas_async_operations()
BEGIN
    DECLARE current_column_type VARCHAR(255);
    DECLARE current_nullable VARCHAR(3);
    DECLARE object_count INT DEFAULT 0;

    SELECT COLUMN_TYPE INTO current_column_type
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'vendas'
      AND COLUMN_NAME = 'status';
    IF current_column_type NOT LIKE '%RESERVA_PROCESSANDO%' THEN
        ALTER TABLE vendas MODIFY COLUMN status ENUM(
            'RESERVA_PROCESSANDO',
            'RESERVA_FALHOU',
            'AGUARDANDO_PAGAMENTO',
            'PAGAMENTO_PROCESSANDO',
            'PAGAMENTO_FALHOU',
            'CANCELADA',
            'PAGAMENTO_CONFIRMADO'
        ) NOT NULL DEFAULT 'AGUARDANDO_PAGAMENTO';
    END IF;

    SELECT IS_NULLABLE INTO current_nullable
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'vendas'
      AND COLUMN_NAME = 'veiculo_id';
    IF current_nullable = 'NO' THEN
        ALTER TABLE vendas MODIFY COLUMN veiculo_id INT NULL;
    END IF;

    SELECT IS_NULLABLE INTO current_nullable
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'vendas'
      AND COLUMN_NAME = 'cliente_id';
    IF current_nullable = 'NO' THEN
        ALTER TABLE vendas MODIFY COLUMN cliente_id INT NULL;
    END IF;

    SELECT IS_NULLABLE INTO current_nullable
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'vendas'
      AND COLUMN_NAME = 'preco';
    IF current_nullable = 'NO' THEN
        ALTER TABLE vendas MODIFY COLUMN preco DECIMAL(10, 2) NULL;
    END IF;

    SELECT COUNT(*) INTO object_count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'vendas'
      AND COLUMN_NAME = 'last_error';
    IF object_count = 0 THEN
        ALTER TABLE vendas ADD COLUMN last_error VARCHAR(500) NULL;
    END IF;

    SELECT COUNT(*) INTO object_count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'vendas'
      AND COLUMN_NAME = 'active_veiculo_placa';
    IF object_count = 0 THEN
        ALTER TABLE vendas ADD COLUMN active_veiculo_placa VARCHAR(10)
            GENERATED ALWAYS AS (
                CASE
                    WHEN status IN (
                        'RESERVA_PROCESSANDO',
                        'AGUARDANDO_PAGAMENTO',
                        'PAGAMENTO_PROCESSANDO',
                        'PAGAMENTO_FALHOU'
                    ) THEN veiculo_placa
                    ELSE NULL
                END
            ) STORED;
    END IF;

    SELECT COUNT(*) INTO object_count
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'vendas'
      AND INDEX_NAME = 'uq_vendas_veiculo_ativo';
    IF object_count = 0 THEN
        ALTER TABLE vendas ADD UNIQUE KEY uq_vendas_veiculo_ativo (active_veiculo_placa);
    END IF;
END//
DELIMITER ;

CALL migrate_vendas_async_operations();
DROP PROCEDURE migrate_vendas_async_operations;
