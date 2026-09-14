ALTER TABLE "material_assets" ADD COLUMN "client_upload_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "material_assets_user_client_upload_uidx" ON "material_assets" USING btree ("user_id","client_upload_id");
