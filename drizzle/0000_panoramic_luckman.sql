CREATE TABLE "events" (
	"session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_session_id_seq_pk" PRIMARY KEY("session_id","seq")
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"session_id" uuid NOT NULL,
	"fact_id" text NOT NULL,
	"text" text NOT NULL,
	"region" text,
	"established_turn" integer DEFAULT 0 NOT NULL,
	"embedding" vector(1024),
	CONSTRAINT "facts_session_id_fact_id_pk" PRIMARY KEY("session_id","fact_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed" bigint NOT NULL,
	"language" text NOT NULL,
	"premise" text DEFAULT '' NOT NULL,
	"sheet" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"session_id" uuid NOT NULL,
	"at_seq" integer NOT NULL,
	"world" jsonb NOT NULL,
	"pc" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshots_session_id_at_seq_pk" PRIMARY KEY("session_id","at_seq")
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_session_seq_idx" ON "events" USING btree ("session_id","seq" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "facts_embedding_idx" ON "facts" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "sessions_updated_idx" ON "sessions" USING btree ("updated_at" DESC NULLS LAST);