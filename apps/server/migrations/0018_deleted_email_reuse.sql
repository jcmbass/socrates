-- R11 (beta cerrada, lote 3) — un correo de cuenta borrada bloqueaba el
-- re-registro para siempre. Se reemplaza el UNIQUE plano sobre primary_email
-- por un unico PARCIAL que solo cuenta cuentas vivas.
-- Revisado a mano: DROP CONSTRAINT + CREATE UNIQUE INDEX. Ninguna fila se
-- muta; el tombstone conserva su primary_email (auditoria).
-- PRECONDICION en prod: no puede haber dos filas vivas con el mismo
-- primary_email (imposible hoy — el constraint plano ya lo impedia), asi que
-- el CREATE UNIQUE INDEX no puede fallar por datos existentes.
ALTER TABLE "users" DROP CONSTRAINT "users_primary_email_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "users_primary_email_active_uidx" ON "users" USING btree ("primary_email") WHERE "users"."account_status" <> 'deleted';
