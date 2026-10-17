/**
 * The sample artifacts offered on first load, one per source format.
 *
 * Both are deliberately awkward rather than tidy, so that "Load sample"
 * demonstrates the engine's real behaviour instead of a happy path any
 * converter would handle.
 */

/**
 * A hyphenated key, an integer and a decimal in one array, a null, an empty
 * array, two same-named nested objects that must not collide, and array items
 * with differing shapes.
 */
export const SAMPLE_JSON = `{
  "id": 42,
  "user-name": "Mahmoud",
  "price": 19.99,
  "active": true,
  "nickname": null,
  "tags": ["java", "spring"],
  "scores": [1, 2.5, null],
  "empty": [],
  "company": { "address": { "city": "Cairo" } },
  "customer": { "address": { "city": "Alexandria" } },
  "orders": [
    { "total": 9.99, "profile": { "city": "Giza" } },
    { "total": 5, "note": "gift", "profile": { "city": "Luxor", "zip": 123 } }
  ]
}`;

/**
 * A required many-to-one, an optional one (nullable foreign key), a
 * one-to-one (the child's key is its primary key), a composite primary key
 * on a join table, and a constraint added by ALTER TABLE.
 */
export const SAMPLE_SQL = `CREATE TABLE users (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  email       VARCHAR(255) NOT NULL UNIQUE,
  full_name   VARCHAR(100),
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE profiles (
  user_id  INT PRIMARY KEY REFERENCES users (id),
  bio      TEXT
);

CREATE TABLE orders (
  id          INT PRIMARY KEY,
  user_id     INT NOT NULL,
  coupon_id   INT NULL,
  total       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  placed_at   TIMESTAMP NOT NULL,
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE coupons (
  id    INT PRIMARY KEY,
  code  VARCHAR(20) NOT NULL UNIQUE
);

CREATE TABLE order_items (
  order_id    INT NOT NULL,
  product_id  INT NOT NULL,
  quantity    INT NOT NULL DEFAULT 1,
  PRIMARY KEY (order_id, product_id)
);

ALTER TABLE orders
  ADD CONSTRAINT fk_orders_coupon FOREIGN KEY (coupon_id) REFERENCES coupons (id);

ALTER TABLE order_items
  ADD CONSTRAINT fk_items_order FOREIGN KEY (order_id) REFERENCES orders (id);
`;

export const SAMPLES: Readonly<Record<string, string>> = {
  json: SAMPLE_JSON,
  sql: SAMPLE_SQL,
};
