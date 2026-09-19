CREATE TABLE "maps" (
	"session_id" uuid NOT NULL,
	"map_id" text NOT NULL,
	"map" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maps_session_id_map_id_pk" PRIMARY KEY("session_id","map_id")
);
--> statement-breakpoint
ALTER TABLE "maps" ADD CONSTRAINT "maps_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;