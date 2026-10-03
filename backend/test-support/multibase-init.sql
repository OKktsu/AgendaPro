-- Credenciais públicas de laboratório, válidas apenas no container local de testes.
CREATE ROLE accounts_lab LOGIN PASSWORD 'accounts_lab_only';
CREATE ROLE tenant_a_lab LOGIN PASSWORD 'tenant_a_lab_only';
CREATE ROLE tenant_b_lab LOGIN PASSWORD 'tenant_b_lab_only';
CREATE DATABASE accounts_lab OWNER accounts_lab;
CREATE DATABASE tenant_a_lab OWNER tenant_a_lab;
CREATE DATABASE tenant_b_lab OWNER tenant_b_lab;
REVOKE CONNECT ON DATABASE accounts_lab FROM PUBLIC;
REVOKE CONNECT ON DATABASE tenant_a_lab FROM PUBLIC;
REVOKE CONNECT ON DATABASE tenant_b_lab FROM PUBLIC;
GRANT CONNECT ON DATABASE accounts_lab TO accounts_lab;
GRANT CONNECT ON DATABASE tenant_a_lab TO tenant_a_lab;
GRANT CONNECT ON DATABASE tenant_b_lab TO tenant_b_lab;
\connect tenant_a_lab
CREATE EXTENSION IF NOT EXISTS btree_gist;
\connect tenant_b_lab
CREATE EXTENSION IF NOT EXISTS btree_gist;
