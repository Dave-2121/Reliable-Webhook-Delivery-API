



CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  url        VARCHAR(2048)   NOT NULL,
  created_at DATETIME(3)     NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS endpoint_subscriptions (
  endpoint_id BIGINT UNSIGNED NOT NULL,
  event_type  VARCHAR(50)     NOT NULL,
  
  PRIMARY KEY (endpoint_id, event_type),
  
  
  KEY idx_subscriptions_event_type (event_type, endpoint_id),
  CONSTRAINT fk_subscriptions_endpoint
    FOREIGN KEY (endpoint_id) REFERENCES webhook_endpoints (id)
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS events (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  
  
  event_id   VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  event_type VARCHAR(50)     NOT NULL,
  payload    JSON            NOT NULL,
  created_at DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  
  
  UNIQUE KEY uq_events_event_id (event_id)
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS deliveries (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_pk         BIGINT UNSIGNED NOT NULL,   
  endpoint_id      BIGINT UNSIGNED NOT NULL,   
  status           ENUM('pending', 'succeeded', 'failed') NOT NULL DEFAULT 'pending',
  attempts         INT UNSIGNED    NOT NULL DEFAULT 0,
  last_status_code SMALLINT UNSIGNED NULL,     
  last_error       VARCHAR(500)    NULL,       
  created_at       DATETIME(3)     NOT NULL,
  last_attempt_at  DATETIME(3)     NULL,
  completed_at     DATETIME(3)     NULL,       
  PRIMARY KEY (id),
  
  UNIQUE KEY uq_deliveries_event_endpoint (event_pk, endpoint_id),
  KEY idx_deliveries_endpoint (endpoint_id),
  CONSTRAINT fk_deliveries_event
    FOREIGN KEY (event_pk) REFERENCES events (id),
  CONSTRAINT fk_deliveries_endpoint
    FOREIGN KEY (endpoint_id) REFERENCES webhook_endpoints (id)
) ENGINE=InnoDB;
