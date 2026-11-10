import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { AnnotationDocument } from "../../../domain/annotation/schema";
import {
  ANNOTATION_RUN_STATUSES,
  type AnnotationContent,
  type AnnotationDefinition,
} from "../../../domain/annotation-runs/schema";
import type { RegionProposal } from "../../../domain/annotation-runs/tasks";
import { USER_ROLES } from "../../../domain/auth/schema";
import type { DetectionResult } from "../../../domain/detection/schema";
import { CULTURE_EVENT_TYPES } from "../../../domain/experiments/culture-events";
import type { TreatmentFactor } from "../../../domain/experiments/schema";
import type {
  DishAnalysis,
  ImageCoverage,
} from "../../../domain/images/coverage";
import type { ImageRegion } from "../../../domain/images/geometry";
import type { RuntimeDescriptor } from "../../../domain/inference/schema";
import type { InferenceFailure } from "../../../domain/inference/tasks";
import { MODEL_AREAS } from "../../../domain/models/area";
import type { ModelBundle } from "../../../domain/models/bundle";
import { MAX_CLASSES, type Tally } from "../../../domain/models/classes";
import type {
  ModelAnnotation,
  ModelArtifact,
  ModelVersion,
} from "../../../domain/models/schema";
import {
  IMAGE_SPLITS,
  TRAINING_ATTEMPT_OUTCOMES,
  TRAINING_PHASES,
  TRAINING_RUN_STATUSES,
  type TrainingCheckpoint,
  type TrainingRecipe,
} from "../../../domain/training/schema";

/**
 * Control plane, detections, and review state live in Postgres; images
 * and model weights are blobs addressed by relative key. Relationships between
 * rows are declared here so that no combination of rows the domain forbids can
 * exist. Images are atomic assets that datasets and snapshots refer to by
 * digest; the references, not the rows, keep an image alive.
 */

const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" }).notNull();

/**
 * Accounts and browser sessions, owned by Better Auth over these tables. The
 * property names are the field names it addresses; the columns follow the
 * naming of the rest of the schema. A user holds exactly one workbench role.
 */

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    role: text("role").notNull(),
    banned: boolean("banned").notNull().default(false),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { withTimezone: true, mode: "date" }),
    createdAt: instant("created_at"),
    updatedAt: instant("updated_at"),
  },
  (table) => [
    check(
      "users_role_check",
      sql`${table.role} in (${sql.raw(
        USER_ROLES.map((role) => `'${role}'`).join(", "),
      )})`,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: instant("expires_at"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    impersonatedBy: text("impersonated_by"),
    createdAt: instant("created_at"),
    updatedAt: instant("updated_at"),
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    password: text("password"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    scope: text("scope"),
    createdAt: instant("created_at"),
    updatedAt: instant("updated_at"),
  },
  (table) => [
    index("accounts_user_idx").on(table.userId),
    uniqueIndex("accounts_provider_account_idx").on(
      table.providerId,
      table.accountId,
    ),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: instant("expires_at"),
    createdAt: instant("created_at"),
    updatedAt: instant("updated_at"),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

const optionalInstant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/**
 * Personal API keys, owned by the Better Auth API key plugin. The secret is
 * stored hashed; `start` keeps its leading characters for display and
 * `permissions` the JSON statement naming the scopes the key opens.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    configId: text("config_id").notNull(),
    name: text("name"),
    start: text("start"),
    prefix: text("prefix"),
    key: text("key").notNull(),
    referenceId: text("reference_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: optionalInstant("last_refill_at"),
    enabled: boolean("enabled").notNull().default(true),
    rateLimitEnabled: boolean("rate_limit_enabled").notNull().default(false),
    rateLimitTimeWindow: integer("rate_limit_time_window"),
    rateLimitMax: integer("rate_limit_max"),
    requestCount: integer("request_count").notNull().default(0),
    remaining: integer("remaining"),
    lastRequest: optionalInstant("last_request"),
    expiresAt: optionalInstant("expires_at"),
    createdAt: instant("created_at"),
    updatedAt: instant("updated_at"),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (table) => [
    index("api_keys_reference_idx").on(table.referenceId),
    index("api_keys_key_idx").on(table.key),
  ],
);

export const jwks = pgTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: instant("created_at"),
  expiresAt: optionalInstant("expires_at"),
  alg: text("alg"),
  crv: text("crv"),
});

/**
 * The OAuth 2.1 authorization server behind the MCP endpoint, owned by the
 * Better Auth MCP plugin: registered clients, the protected resources they
 * may address, the tokens issued to them, and the consent each account gave.
 */

export const oauthClients = pgTable(
  "oauth_clients",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    clientDiscoveryId: text("client_discovery_id"),
    disabled: boolean("disabled").notNull().default(false),
    skipConsent: boolean("skip_consent"),
    enableEndSession: boolean("enable_end_session"),
    subjectType: text("subject_type"),
    scopes: text("scopes").array(),
    clientCredentialsScopes: text("client_credentials_scopes").array(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: optionalInstant("created_at"),
    updatedAt: optionalInstant("updated_at"),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts").array(),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").array().notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
    backchannelLogoutUri: text("backchannel_logout_uri"),
    backchannelLogoutSessionRequired: boolean(
      "backchannel_logout_session_required",
    ),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    applicationType: text("application_type"),
    jwks: text("jwks"),
    jwksUri: text("jwks_uri"),
    grantTypes: text("grant_types").array(),
    responseTypes: text("response_types").array(),
    requirePKCE: boolean("require_pkce"),
    dpopBoundAccessTokens: boolean("dpop_bound_access_tokens")
      .notNull()
      .default(false),
    referenceId: text("reference_id"),
    metadata: jsonb("metadata"),
  },
  (table) => [index("oauth_clients_user_idx").on(table.userId)],
);

export const oauthResources = pgTable("oauth_resources", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: text("allowed_scopes").array(),
  customClaims: jsonb("custom_claims"),
  dpopBoundAccessTokensRequired: boolean("dpop_bound_access_tokens_required")
    .notNull()
    .default(false),
  disabled: boolean("disabled").notNull().default(false),
  createdAt: optionalInstant("created_at"),
  updatedAt: optionalInstant("updated_at"),
  policyVersion: integer("policy_version").notNull().default(1),
  metadata: jsonb("metadata"),
});

export const oauthClientResources = pgTable(
  "oauth_client_resources",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => oauthResources.identifier, { onDelete: "cascade" }),
    metadata: jsonb("metadata"),
    createdAt: optionalInstant("created_at"),
  },
  (table) => [
    uniqueIndex("oauth_client_resources_client_resource_idx").on(
      table.clientId,
      table.resourceId,
    ),
  ],
);

export const oauthRefreshTokens = pgTable(
  "oauth_refresh_tokens",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    expiresAt: instant("expires_at"),
    createdAt: instant("created_at"),
    revoked: optionalInstant("revoked"),
    rotatedAt: optionalInstant("rotated_at"),
    rotationReplayResponse: text("rotation_replay_response"),
    rotationReplayExpiresAt: optionalInstant("rotation_replay_expires_at"),
    authTime: optionalInstant("auth_time"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => [
    index("oauth_refresh_tokens_client_idx").on(table.clientId),
    index("oauth_refresh_tokens_user_idx").on(table.userId),
  ],
);

export const oauthAccessTokens = pgTable(
  "oauth_access_tokens",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    refreshId: text("refresh_id").references(() => oauthRefreshTokens.id, {
      onDelete: "cascade",
    }),
    expiresAt: instant("expires_at"),
    createdAt: instant("created_at"),
    revoked: optionalInstant("revoked"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => [
    index("oauth_access_tokens_client_idx").on(table.clientId),
    index("oauth_access_tokens_user_idx").on(table.userId),
  ],
);

export const oauthConsents = pgTable(
  "oauth_consents",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    referenceId: text("reference_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    scopes: text("scopes").array().notNull(),
    createdAt: instant("created_at"),
    updatedAt: instant("updated_at"),
  },
  (table) => [
    index("oauth_consents_client_idx").on(table.clientId),
    index("oauth_consents_user_idx").on(table.userId),
  ],
);

export const oauthClientAssertions = pgTable("oauth_client_assertions", {
  id: text("id").primaryKey(),
  expiresAt: instant("expires_at"),
});

export const models = pgTable(
  "models",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    task: text("task").notNull(),
    classes: jsonb("classes").$type<string[]>().notNull(),
    /** The classes a day counts unless it names its own; observations keep theirs as they are made. */
    countedClasses: jsonb("counted_classes").$type<string[]>().notNull(),
    /** Where in a photograph the task looks; snapshots and runs freeze it as they are made. */
    area: text("area", { enum: MODEL_AREAS }).notNull(),
    annotation: jsonb("annotation").$type<ModelAnnotation>().notNull(),
    /**
     * The version a person chose to read the model's images. A trained
     * version waits here as a candidate until someone chooses it; none
     * leaves the images for a reviewer.
     */
    currentVersionId: text("current_version_id"),
  },
  (table) => [
    /** The current version is one of the model's own. */
    foreignKey({
      columns: [table.currentVersionId, table.id],
      foreignColumns: [modelVersions.id, modelVersions.modelId],
    }),
    check("models_area_check", sql`${table.area} in ('image', 'dish')`),
    check(
      "models_classes_check",
      sql`jsonb_typeof(${table.classes}) = 'array' and jsonb_array_length(${table.classes}) between 1 and ${sql.raw(String(MAX_CLASSES))}`,
    ),
    check(
      "models_counted_classes_check",
      sql`jsonb_typeof(${table.countedClasses}) = 'array' and jsonb_array_length(${table.countedClasses}) > 0`,
    ),
  ],
);

export const modelVersions = pgTable(
  "model_versions",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id")
      .notNull()
      .references((): AnyPgColumn => models.id),
    /** The classes the version finds, of its model's and in the model's order. */
    classes: jsonb("classes").$type<string[]>().notNull(),
    createdAt: instant("created_at"),
    source: jsonb("source").$type<ModelVersion["source"]>().notNull(),
    artifact: jsonb("artifact").$type<ModelArtifact>().notNull(),
    weightsKey: text("weights_key"),
    artifactDigest: text("artifact_digest")
      .notNull()
      .generatedAlwaysAs(sql`artifact->>'digest'`),
    sourceKind: text("source_kind")
      .notNull()
      .generatedAlwaysAs(sql`source->>'kind'`),
    sourceTrainingRunId: text("source_training_run_id")
      .generatedAlwaysAs(sql`source->>'trainingRunId'`)
      .references((): AnyPgColumn => trainingRuns.id),
    sourceTrainingAttempt: integer("source_training_attempt").generatedAlwaysAs(
      sql`(source->>'trainingAttempt')::integer`,
    ),
    sourceDatasetSnapshotId: text("source_dataset_snapshot_id")
      .generatedAlwaysAs(sql`source->>'datasetSnapshotId'`)
      .references((): AnyPgColumn => datasetSnapshots.id),
    artifactKind: text("artifact_kind")
      .notNull()
      .generatedAlwaysAs(sql`artifact->>'kind'`),
    weightsDigest: text("weights_digest").generatedAlwaysAs(
      sql`artifact->'weights'->>'digest'`,
    ),
    weightsBytes: integer("weights_bytes").generatedAlwaysAs(
      sql`(artifact->'weights'->>'bytes')::integer`,
    ),
  },
  (table) => [
    index("model_versions_model_idx").on(table.modelId, table.createdAt),
    /** Lets referencing rows assert that a version belongs to their model. */
    unique("model_versions_id_model").on(table.id, table.modelId),
    /** Runtime records bind to executable content, not just a version name. */
    unique("model_versions_id_digest").on(table.id, table.artifactDigest),
    unique("model_versions_publication_identity").on(
      table.id,
      table.sourceTrainingRunId,
      table.sourceTrainingAttempt,
      table.sourceDatasetSnapshotId,
      table.modelId,
    ),
    check(
      "model_versions_digest_check",
      sql`${table.artifactDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "model_versions_source_artifact_check",
      sql`case ${table.sourceKind}
        when 'builtin' then ${table.artifactKind} = 'traditional' and ${table.sourceTrainingRunId} is null and ${table.sourceTrainingAttempt} is null and ${table.sourceDatasetSnapshotId} is null and ${table.weightsDigest} is null and ${table.weightsBytes} is null
        when 'training_run' then ${table.artifactKind} = 'ultralytics' and ${table.sourceTrainingRunId} is not null and ${table.sourceTrainingAttempt} >= 1 and ${table.sourceDatasetSnapshotId} is not null and ${table.weightsDigest} ~ '^[0-9a-f]{64}$' and ${table.weightsBytes} > 0
        when 'import' then ${table.artifactKind} = 'ultralytics' and ${table.sourceTrainingRunId} is null and ${table.sourceTrainingAttempt} is null and ${table.sourceDatasetSnapshotId} is null and ${table.weightsDigest} ~ '^[0-9a-f]{64}$' and ${table.weightsBytes} > 0
        else false
      end`,
    ),
  ],
);

export const modelUploads = pgTable("model_uploads", {
  id: text("id").primaryKey(),
  modelId: text("model_id")
    .notNull()
    .references(() => models.id),
  bundle: jsonb("bundle").$type<ModelBundle>().notNull(),
  weightsKey: text("weights_key").notNull(),
  expiresAt: timestamp("expires_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  artifactDigest: text("artifact_digest"),
  versionId: text("version_id").references(() => modelVersions.id),
});

/**
 * A training set for one model: the images whose reviews for that model
 * train its next version. Datasets draw from experiment images; they
 * never receive uploads of their own.
 */
export const datasets = pgTable(
  "datasets",
  {
    id: uuid("id").primaryKey(),
    /** How people and transfer address the dataset; renaming keeps the id. */
    name: text("name").notNull(),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id),
    createdAt: instant("created_at"),
  },
  (table) => [
    /** Lets snapshot rows assert that they froze this dataset for its model. */
    unique("datasets_id_model").on(table.id, table.modelId),
    /** Data roots keep a dataset in a folder of its name, on any file system. */
    uniqueIndex("datasets_name").on(sql`lower(${table.name})`),
    check(
      "datasets_name_check",
      sql`${table.name} ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'`,
    ),
  ],
);

/**
 * An image, identified by the SHA-256 digest of its bytes. Images belong
 * to nothing; experiments, datasets, snapshots, and annotations refer to them.
 * Geometry describes the bytes; analysis metadata records detection and retries.
 *
 * An image with no reference is unclaimed: bytes arrive before the observation they
 * join is submitted. `receivedAt` is when the bytes last arrived and bounds
 * how long that submission may still be in progress.
 */
export const images = pgTable(
  "images",
  {
    id: text("id").primaryKey(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    dishAnalysis: jsonb("dish_analysis").$type<DishAnalysis>(),
    dishAnalysisAttemptedAt: timestamp("dish_analysis_attempted_at", {
      withTimezone: true,
      mode: "date",
    }),
    receivedAt: instant("received_at"),
  },
  (table) => [
    check("images_id_check", sql`${table.id} ~ '^[0-9a-f]{64}$'`),
    check("images_bytes_check", sql`${table.bytes} > 0`),
    check(
      "images_analysis_check",
      sql`${table.dishAnalysis} is null or (
      jsonb_typeof(${table.dishAnalysis}) = 'object'
      and ${table.dishAnalysis} ?& array['recipe', 'circle']
      and jsonb_typeof(${table.dishAnalysis}->'recipe') = 'string'
      and (${table.dishAnalysis}->>'recipe') ~ '^[a-f0-9]{64}$'
      and (${table.dishAnalysis}->'circle' = 'null'::jsonb or (
        jsonb_typeof(${table.dishAnalysis}->'circle') = 'object'
        and ${table.dishAnalysis}->'circle' ?& array['x', 'y', 'radius']
        and jsonb_typeof(${table.dishAnalysis}->'circle'->'x') = 'number'
        and jsonb_typeof(${table.dishAnalysis}->'circle'->'y') = 'number'
        and jsonb_typeof(${table.dishAnalysis}->'circle'->'radius') = 'number'
        and (${table.dishAnalysis}->'circle'->>'x')::double precision >= 0
        and (${table.dishAnalysis}->'circle'->>'x')::double precision < ${table.width}
        and (${table.dishAnalysis}->'circle'->>'y')::double precision >= 0
        and (${table.dishAnalysis}->'circle'->>'y')::double precision < ${table.height}
        and (${table.dishAnalysis}->'circle'->>'radius')::double precision > 0
      ))
    )`,
    ),
    check("images_size_check", sql`${table.width} > 0 and ${table.height} > 0`),
    /** The collector reads unreferenced images oldest first. */
    index("images_received_idx").on(table.receivedAt),
    index("images_analysis_attempted_idx").on(
      table.dishAnalysisAttemptedAt.asc().nullsFirst(),
      table.id,
    ),
  ],
);

/**
 * A photograph a person could not read clearly. The mark is the canonical
 * image's, whichever experiment or dataset shows it, and no row means the
 * photograph is clear. Each experiment decides whether its unclear
 * photographs count. A mark roots nothing: an image that is collected takes
 * its mark with it.
 */
export const unclearImages = pgTable("unclear_images", {
  imageId: text("image_id")
    .primaryKey()
    .references(() => images.id, { onDelete: "cascade" }),
});

export const datasetImages = pgTable(
  "dataset_images",
  {
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    imageId: text("image_id")
      .notNull()
      .references(() => images.id),
    /** The name the image was added under; shown and searched, never its identity. */
    filename: text("filename").notNull(),
    addedAt: instant("added_at"),
    /** Assigned the first time the image enters a snapshot; stable afterwards. */
    split: text("split", { enum: IMAGE_SPLITS }),
  },
  (table) => [
    primaryKey({ columns: [table.datasetId, table.imageId] }),
    index("dataset_images_image_idx").on(table.imageId),
    check(
      "dataset_images_split_check",
      sql`${table.split} is null or ${table.split} in ('train', 'val')`,
    ),
  ],
);

/**
 * What a model version found in an image, addressed by its canonical business
 * key. Experiment sheets read the current version of each observation's model;
 * reviews may show one as a reference but never own it. A row is written once:
 * an identical resubmission is accepted and a different one refused, so the
 * result stays a record and never a cache.
 */
export const inferenceOutcomes = pgTable(
  "inference_outcomes",
  {
    imageId: text("image_id")
      .notNull()
      .references(() => images.id, { onDelete: "cascade" }),
    modelVersionId: text("model_version_id").notNull(),
    document: jsonb("document").$type<DetectionResult>().notNull(),
    /** The instances per class the document holds, kept beside it so a reading need not open it. */
    tally: jsonb("tally")
      .$type<Tally>()
      .notNull()
      .generatedAlwaysAs(sql`document_tally(document)`),
    recordedAt: instant("recorded_at"),
    artifactDigest: text("artifact_digest")
      .notNull()
      .generatedAlwaysAs(sql`document->'producer'->>'artifactDigest'`),
  },
  (table) => [
    primaryKey({ columns: [table.imageId, table.modelVersionId] }),
    index("inference_outcomes_version_idx").on(table.modelVersionId),
    /** The document was produced by the registered artifact of its version. */
    foreignKey({
      columns: [table.modelVersionId, table.artifactDigest],
      foreignColumns: [modelVersions.id, modelVersions.artifactDigest],
    }),
    check(
      "inference_outcomes_document_check",
      sql`document->'image'->>'digest' = ${table.imageId} and document->'producer'->>'modelVersionId' = ${table.modelVersionId}`,
    ),
    check(
      "inference_outcomes_shape_check",
      sql`document ? 'instances' and not document ? 'error'`,
    ),
  ],
);

/**
 * What a reviewer decided about one image for one model: the human truth the
 * model's next version trains on. The review is the same document whether it
 * is opened from an experiment or from a dataset, because it belongs to the
 * image and the model, not to the place it was opened from. It refers to no
 * detection: what a version found is that version's record, and the review
 * outlives every version it was compared with.
 */
export const annotations = pgTable(
  "annotations",
  {
    imageId: text("image_id")
      .notNull()
      .references(() => images.id),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id),
    document: jsonb("document").$type<AnnotationDocument>().notNull(),
    /** The instances per class the review holds. */
    tally: jsonb("tally")
      .$type<Tally>()
      .notNull()
      .generatedAlwaysAs(sql`document_tally(document)`),
    updatedAt: instant("updated_at"),
  },
  (table) => [
    primaryKey({ columns: [table.imageId, table.modelId] }),
    check(
      "annotations_image_check",
      sql`document->'image'->>'digest' = ${table.imageId}`,
    ),
  ],
);

export const experiments = pgTable(
  "experiments",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    plantMaterial: text("plant_material").notNull(),
    explantType: text("explant_type").notNull(),
    baseMedium: text("base_medium").notNull(),
    notes: text("notes").notNull(),
    inoculatedOn: date("inoculated_on", { mode: "string" }).notNull(),
    /** Whether a unit with a photograph marked unclear stays in the analysis. */
    countsUnclear: boolean("counts_unclear").notNull().default(false),
    createdAt: instant("created_at"),
  },
  (table) => [
    unique("experiments_id_inoculated").on(table.id, table.inoculatedOn),
    uniqueIndex("experiments_name").on(sql`lower(${table.name})`),
    check(
      "experiments_name_check",
      sql`${table.name} = btrim(${table.name}) and length(${table.name}) between 1 and 120`,
    ),
    check(
      "experiments_plant_material_check",
      sql`${table.plantMaterial} = btrim(${table.plantMaterial}) and length(${table.plantMaterial}) <= 120`,
    ),
    check(
      "experiments_explant_type_check",
      sql`${table.explantType} = btrim(${table.explantType}) and length(${table.explantType}) <= 120`,
    ),
    check(
      "experiments_base_medium_check",
      sql`${table.baseMedium} = btrim(${table.baseMedium}) and length(${table.baseMedium}) <= 200`,
    ),
    check(
      "experiments_notes_check",
      sql`${table.notes} = btrim(${table.notes}) and length(${table.notes}) <= 2000`,
    ),
  ],
);

export const experimentTreatments = pgTable(
  "experiment_treatments",
  {
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    id: uuid("id").notNull(),
    name: text("name").notNull(),
    factor: jsonb("factor").$type<TreatmentFactor>(),
    note: text("note").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.experimentId, table.id] }),
    uniqueIndex("experiment_treatments_name").on(
      table.experimentId,
      sql`lower(${table.name})`,
    ),
    unique("experiment_treatments_position").on(
      table.experimentId,
      table.position,
    ),
    check(
      "experiment_treatments_name_check",
      sql`${table.name} = btrim(${table.name}) and length(${table.name}) between 1 and 120`,
    ),
    check(
      "experiment_treatments_note_check",
      sql`${table.note} = btrim(${table.note}) and length(${table.note}) <= 1000`,
    ),
    check(
      "experiment_treatments_factor_check",
      sql`${table.factor} is null or (
        jsonb_typeof(${table.factor}) = 'object'
        and coalesce(${table.factor}->>'name', '') <> ''
        and coalesce(${table.factor}->>'level', '') <> ''
        and (${table.factor}->>'unit') is not null
      )`,
    ),
    check("experiment_treatments_position_check", sql`${table.position} >= 1`),
  ],
);

/**
 * One occasion on which the experiment was observed. The day it happened
 * places it in the series and, against the inoculation date, names it. The
 * observation names the model its images are read for, and which of that
 * model's classes the day counts; which of the model's versions has read
 * them, if any, is recorded per image.
 */
export const experimentObservations = pgTable(
  "experiment_observations",
  {
    experimentId: uuid("experiment_id").notNull(),
    id: uuid("id").notNull(),
    inoculatedOn: date("inoculated_on", { mode: "string" }).notNull(),
    observedOn: date("observed_on", { mode: "string" }).notNull(),
    note: text("note").notNull(),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id),
    /**
     * A tally keeps every class its image holds and the day's count sums only
     * these, so changing them recounts the same readings.
     */
    countedClasses: jsonb("counted_classes").$type<string[]>().notNull(),
    createdAt: instant("created_at"),
  },
  (table) => [
    primaryKey({ columns: [table.experimentId, table.id] }),
    index("experiment_observations_model_idx").on(table.modelId),
    foreignKey({
      columns: [table.experimentId, table.inoculatedOn],
      foreignColumns: [experiments.id, experiments.inoculatedOn],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    /** An experiment observes its units once a day at most. */
    unique("experiment_observations_day").on(
      table.experimentId,
      table.observedOn,
    ),
    check(
      "experiment_observations_note_check",
      sql`${table.note} = btrim(${table.note}) and length(${table.note}) <= 500`,
    ),
    check(
      "experiment_observations_date_check",
      sql`${table.observedOn} >= ${table.inoculatedOn}`,
    ),
    check(
      "experiment_observations_counted_classes_check",
      sql`jsonb_typeof(${table.countedClasses}) = 'array' and jsonb_array_length(${table.countedClasses}) > 0`,
    ),
  ],
);

/**
 * The experimental units: the vessels a treatment is applied to and
 * measurements are made on. A unit replicates exactly one treatment, exists
 * before any image, and keeps its identity when its code is corrected.
 */
export const experimentUnits = pgTable(
  "experiment_units",
  {
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    id: uuid("id").notNull(),
    code: text("code").notNull(),
    /**
     * The code as units are ordered by: its numbers compared by value, so
     * `T1-2` precedes `T1-10`, and its letters regardless of case. Compared
     * bytewise (`collate "C"`); generated by `unit_code_order` (migration
     * 0011), the one definition of the experiment's order of units.
     */
    codeOrder: text("code_order")
      .notNull()
      .generatedAlwaysAs(sql`unit_code_order(code)`),
    treatmentId: uuid("treatment_id").notNull(),
    /**
     * The observation the unit's rates are taken against where a person
     * named one; null takes them against the experiment's first.
     */
    baselineObservationId: uuid("baseline_observation_id"),
  },
  (table) => [
    primaryKey({ columns: [table.experimentId, table.id] }),
    foreignKey({
      name: "experiment_units_baseline_observation_fk",
      columns: [table.experimentId, table.baselineObservationId],
      foreignColumns: [
        experimentObservations.experimentId,
        experimentObservations.id,
      ],
    }),
    uniqueIndex("experiment_units_code").on(
      table.experimentId,
      sql`lower(${table.code})`,
    ),
    foreignKey({
      columns: [table.experimentId, table.treatmentId],
      foreignColumns: [
        experimentTreatments.experimentId,
        experimentTreatments.id,
      ],
    }).onDelete("cascade"),
    index("experiment_units_treatment_idx").on(
      table.experimentId,
      table.treatmentId,
    ),
    check(
      "experiment_units_code_check",
      sql`${table.code} = btrim(${table.code}) and length(${table.code}) between 1 and 60`,
    ),
  ],
);

export const experimentCultureEvents = pgTable(
  "experiment_culture_events",
  {
    experimentId: uuid("experiment_id").notNull(),
    id: uuid("id").notNull(),
    unitId: uuid("unit_id").notNull(),
    observationId: uuid("observation_id").notNull(),
    type: text("type", { enum: CULTURE_EVENT_TYPES }).notNull(),
    recordedAt: instant("recorded_at"),
  },
  (table) => [
    primaryKey({ columns: [table.experimentId, table.id] }),
    foreignKey({
      columns: [table.experimentId, table.unitId],
      foreignColumns: [experimentUnits.experimentId, experimentUnits.id],
    }),
    foreignKey({
      columns: [table.experimentId, table.observationId],
      foreignColumns: [
        experimentObservations.experimentId,
        experimentObservations.id,
      ],
    }),
    uniqueIndex("experiment_culture_events_one_kind").on(
      table.experimentId,
      table.unitId,
      table.observationId,
      table.type,
    ),
    uniqueIndex("experiment_culture_events_one_terminal")
      .on(table.experimentId, table.unitId)
      .where(sql`${table.type} in ('discarded', 'harvested', 'missing')`),
    index("experiment_culture_events_observation_idx").on(
      table.experimentId,
      table.observationId,
    ),
    check(
      "experiment_culture_events_type_check",
      sql`${table.type} in ('contaminated', 'nonviable', 'discarded', 'harvested', 'missing')`,
    ),
  ],
);

/**
 * One image assigned to a unit and an observation. The filename
 * records the image's origin and identifies nothing.
 */
export const experimentObservationImages = pgTable(
  "experiment_observation_images",
  {
    experimentId: uuid("experiment_id").notNull(),
    id: uuid("id").notNull(),
    unitId: uuid("unit_id").notNull(),
    observationId: uuid("observation_id").notNull(),
    /** An assigned observation image is a reference root; deletion is refused. */
    imageId: text("image_id")
      .notNull()
      .references(() => images.id),
    filename: text("filename").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.experimentId, table.id] }),
    foreignKey({
      columns: [table.experimentId, table.unitId],
      foreignColumns: [experimentUnits.experimentId, experimentUnits.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.experimentId, table.observationId],
      foreignColumns: [
        experimentObservations.experimentId,
        experimentObservations.id,
      ],
    }).onDelete("cascade"),
    /** One unit has one image per observation. */
    unique("experiment_observation_images_cell").on(
      table.experimentId,
      table.unitId,
      table.observationId,
    ),
    /** The same image cannot represent two units or two occasions. */
    unique("experiment_observation_images_image").on(
      table.experimentId,
      table.imageId,
    ),
    index("experiment_observation_images_observation_idx").on(
      table.experimentId,
      table.observationId,
    ),
    index("experiment_observation_images_image_idx").on(table.imageId),
  ],
);

/**
 * A count a person entered for a unit on an observation: what they counted
 * at the bench, whether or not the dish was photographed. It is kept by
 * class, like the tally a photograph yields, so the day counts it over the
 * classes it names. A unit has one such count per observation, and it
 * outranks every reading of the day's photograph.
 */
export const experimentManualReadings = pgTable(
  "experiment_manual_readings",
  {
    experimentId: uuid("experiment_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    observationId: uuid("observation_id").notNull(),
    tally: jsonb("tally").$type<Tally>().notNull(),
    recordedAt: instant("recorded_at"),
  },
  (table) => [
    primaryKey({
      columns: [table.experimentId, table.unitId, table.observationId],
    }),
    foreignKey({
      columns: [table.experimentId, table.unitId],
      foreignColumns: [experimentUnits.experimentId, experimentUnits.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.experimentId, table.observationId],
      foreignColumns: [
        experimentObservations.experimentId,
        experimentObservations.id,
      ],
    }).onDelete("cascade"),
    index("experiment_manual_readings_observation_idx").on(
      table.experimentId,
      table.observationId,
    ),
    check(
      "experiment_manual_readings_tally_check",
      sql`jsonb_typeof(${table.tally}) = 'object'`,
    ),
  ],
);

/**
 * A machine an administrator enrolled as a worker. Its token is its identity:
 * only the token's hash is kept, and removing the worker revokes it.
 */
export const workers = pgTable("workers", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  enrolledAt: instant("enrolled_at"),
});

/**
 * The process currently serving as a worker, by what it can execute and how
 * much memory it offers a task. What it is doing follows from the lease it
 * holds.
 */
export const workerSessions = pgTable(
  "worker_sessions",
  {
    workerId: text("worker_id")
      .primaryKey()
      .references(() => workers.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    startedAt: instant("started_at"),
    runtimes: jsonb("runtimes").$type<RuntimeDescriptor[]>().notNull(),
    memoryBytes: bigint("memory_bytes", { mode: "number" }).notNull(),
    lastSeenAt: instant("last_seen_at"),
  },
  (table) => [index("worker_sessions_seen_idx").on(table.lastSeenAt)],
);

/** Durable image/version work and the bounded attempts that execute it. */
export const inferenceTasks = pgTable(
  "inference_tasks",
  {
    imageId: text("image_id")
      .notNull()
      .references(() => images.id, { onDelete: "cascade" }),
    modelVersionId: text("model_version_id")
      .notNull()
      .references(() => modelVersions.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["queued", "running", "succeeded", "failed"],
    }).notNull(),
    attempt: integer("attempt").notNull().default(0),
    attemptsInCycle: integer("attempts_in_cycle").notNull().default(0),
    createdAt: instant("created_at"),
    availableAt: instant("available_at"),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    error: text("error"),
  },
  (t) => [
    primaryKey({ columns: [t.imageId, t.modelVersionId] }),
    index("inference_tasks_ready_idx").on(t.status, t.availableAt),
    check(
      "inference_tasks_attempt_check",
      sql`${t.attempt} >= ${t.attemptsInCycle} and ${t.attemptsInCycle} >= 0`,
    ),
    check(
      "inference_tasks_state_check",
      sql`case ${t.status}
    when 'queued' then ${t.finishedAt} is null
    when 'running' then ${t.finishedAt} is null and ${t.attempt} > 0
    when 'succeeded' then ${t.finishedAt} is not null and ${t.error} is null
    when 'failed' then ${t.finishedAt} is not null and length(${t.error}) > 0
    else false end`,
    ),
  ],
);

export const inferenceAttempts = pgTable(
  "inference_attempts",
  {
    imageId: text("image_id").notNull(),
    modelVersionId: text("model_version_id").notNull(),
    attempt: integer("attempt").notNull(),
    // History remains meaningful after a worker is unenrolled.
    workerId: text("worker_id").notNull(),
    sessionId: text("session_id").notNull(),
    startedAt: instant("started_at"),
    deadlineAt: instant("deadline_at"),
    leaseExpiresAt: instant("lease_expires_at"),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    status: text("status", {
      enum: ["running", "succeeded", "failed"],
    }).notNull(),
    failure: jsonb("failure").$type<InferenceFailure>(),
    resultDigest: text("result_digest"),
  },
  (t) => [
    primaryKey({ columns: [t.imageId, t.modelVersionId, t.attempt] }),
    foreignKey({
      columns: [t.imageId, t.modelVersionId],
      foreignColumns: [inferenceTasks.imageId, inferenceTasks.modelVersionId],
    }).onDelete("cascade"),
    uniqueIndex("inference_attempts_one_per_worker")
      .on(t.workerId)
      .where(sql`${t.status} = 'running'`),
    uniqueIndex("inference_attempts_one_per_task")
      .on(t.imageId, t.modelVersionId)
      .where(sql`${t.status} = 'running'`),
    index("inference_attempts_expiry_idx").on(t.status, t.leaseExpiresAt),
    index("inference_attempts_worker_failure_idx")
      .on(t.workerId, t.finishedAt)
      .where(sql`${t.status} = 'failed'`),
    check(
      "inference_attempts_deadline_check",
      sql`${t.attempt} > 0 and ${t.startedAt} < ${t.deadlineAt} and ${t.leaseExpiresAt} <= ${t.deadlineAt}`,
    ),
    check(
      "inference_attempts_state_check",
      sql`case ${t.status}
    when 'running' then ${t.finishedAt} is null and ${t.failure} is null and ${t.resultDigest} is null
    when 'succeeded' then ${t.finishedAt} is not null and ${t.failure} is null and ${t.resultDigest} is not null
    when 'failed' then ${t.finishedAt} is not null and ${t.failure} is not null and ${t.resultDigest} is null
    else false end`,
    ),
  ],
);

export const datasetSnapshots = pgTable(
  "dataset_snapshots",
  {
    id: text("id").primaryKey(),
    datasetId: uuid("dataset_id").notNull(),
    modelId: text("model_id").notNull(),
    /** The model's classes as the snapshot froze them; its version finds these. */
    classes: jsonb("classes").$type<string[]>().notNull(),
    /** The model's area as the snapshot froze it; its images are framed to it. */
    area: text("area", { enum: MODEL_AREAS }).notNull(),
    createdAt: instant("created_at"),
  },
  (table) => [
    /** A snapshot's model is its dataset's model. */
    foreignKey({
      columns: [table.datasetId, table.modelId],
      foreignColumns: [datasets.id, datasets.modelId],
    }),
    unique("dataset_snapshots_id_model").on(table.id, table.modelId),
    index("dataset_snapshots_dataset_idx").on(table.datasetId),
    check(
      "dataset_snapshots_area_check",
      sql`${table.area} in ('image', 'dish')`,
    ),
  ],
);

/**
 * The reviewed images a snapshot froze, with the annotation as reviewed and
 * the dish coverage the image is framed to, null for the whole image. The
 * image reference keeps the bytes alive for as long as the snapshot exists.
 */
export const datasetSnapshotImages = pgTable(
  "dataset_snapshot_images",
  {
    snapshotId: text("snapshot_id").notNull(),
    modelId: text("model_id").notNull(),
    imageId: text("image_id")
      .notNull()
      .references(() => images.id),
    split: text("split", { enum: IMAGE_SPLITS }).notNull(),
    coverage: jsonb("coverage").$type<ImageCoverage>(),
    annotation: jsonb("annotation").$type<AnnotationDocument>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.imageId] }),
    foreignKey({
      columns: [table.snapshotId, table.modelId],
      foreignColumns: [datasetSnapshots.id, datasetSnapshots.modelId],
    }).onDelete("cascade"),
    index("dataset_snapshot_images_image_idx").on(table.imageId),
    check(
      "dataset_snapshot_images_split_check",
      sql`${table.split} in ('train', 'val')`,
    ),
    check(
      "dataset_snapshot_images_annotation_check",
      sql`annotation->'image'->>'digest' = ${table.imageId}`,
    ),
  ],
);

export const trainingRuns = pgTable(
  "training_runs",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id),
    datasetSnapshotId: text("dataset_snapshot_id").notNull(),
    createdAt: instant("created_at"),
    attempt: integer("attempt").notNull(),
    targetWorkerId: text("target_worker_id"),
    lastProgressAt: timestamp("last_progress_at", {
      withTimezone: true,
      mode: "date",
    }),
    checkpoint: jsonb("checkpoint").$type<TrainingCheckpoint>(),
    recipe: jsonb("recipe").$type<TrainingRecipe>().notNull(),
    status: text("status", { enum: TRAINING_RUN_STATUSES }).notNull(),
    workerId: text("worker_id"),
    sessionId: text("session_id"),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    phase: text("phase", { enum: TRAINING_PHASES }),
    progress: real("progress"),
    error: text("error"),
    modelVersionId: text("model_version_id"),
  },
  (table) => [
    /** A run trains its model on a snapshot of that model's dataset. */
    foreignKey({
      columns: [table.datasetSnapshotId, table.modelId],
      foreignColumns: [datasetSnapshots.id, datasetSnapshots.modelId],
    }),
    /** A run publishes a version of its own model. */
    foreignKey({
      columns: [table.modelVersionId, table.modelId],
      foreignColumns: [modelVersions.id, modelVersions.modelId],
    }),
    foreignKey({
      columns: [
        table.modelVersionId,
        table.id,
        table.attempt,
        table.datasetSnapshotId,
        table.modelId,
      ],
      foreignColumns: [
        modelVersions.id,
        modelVersions.sourceTrainingRunId,
        modelVersions.sourceTrainingAttempt,
        modelVersions.sourceDatasetSnapshotId,
        modelVersions.modelId,
      ],
    }),
    check("training_runs_attempt_check", sql`${table.attempt} >= 0`),
    /** Each status has exactly the columns its state carries. */
    check(
      "training_runs_state_check",
      sql`case ${table.status}
        when 'queued' then ${table.workerId} is null and ${table.sessionId} is null and ${table.leaseExpiresAt} is null and ${table.phase} is null and ${table.progress} is null and ${table.error} is null and ${table.modelVersionId} is null
        when 'paused' then ${table.workerId} is null and ${table.sessionId} is null and ${table.leaseExpiresAt} is null and ${table.phase} is null and ${table.progress} is null and ${table.error} is null and ${table.modelVersionId} is null
        when 'cancelled' then ${table.workerId} is null and ${table.sessionId} is null and ${table.leaseExpiresAt} is null and ${table.phase} is null and ${table.progress} is null and ${table.error} is null and ${table.modelVersionId} is null
        when 'running' then ${table.workerId} is not null and ${table.sessionId} is not null and ${table.leaseExpiresAt} is not null and ${table.phase} in ('preparing', 'training', 'validating') and ${table.progress} is not null and ${table.progress} between 0 and 1 and ${table.error} is null and ${table.modelVersionId} is null
        when 'succeeded' then ${table.workerId} is null and ${table.sessionId} is null and ${table.leaseExpiresAt} is null and ${table.phase} is null and ${table.progress} is null and ${table.error} is null and ${table.modelVersionId} is not null
        when 'failed' then ${table.workerId} is null and ${table.sessionId} is null and ${table.leaseExpiresAt} is null and ${table.phase} is null and ${table.progress} is null and length(${table.error}) between 1 and 2000 and ${table.modelVersionId} is null
        else false
      end`,
    ),
    /** A model trains one run at a time. */
    uniqueIndex("training_runs_one_active_per_model")
      .on(table.modelId)
      .where(sql`${table.status} in ('queued', 'running')`),
    index("training_runs_model_idx").on(table.modelId, table.createdAt),
    index("training_runs_claimable_idx")
      .on(table.createdAt)
      .where(sql`${table.status} in ('queued', 'running')`),
  ],
);

export const trainingAttempts = pgTable(
  "training_attempts",
  {
    runId: text("run_id")
      .notNull()
      .references(() => trainingRuns.id),
    attempt: integer("attempt").notNull(),
    workerId: text("worker_id").notNull(),
    startedAt: instant("started_at"),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    outcome: text("outcome", {
      enum: TRAINING_ATTEMPT_OUTCOMES,
    }),
    error: text("error"),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.attempt] }),
    uniqueIndex("training_attempts_active_idx")
      .on(table.runId)
      .where(sql`${table.finishedAt} is null`),
    check("training_attempts_number_check", sql`${table.attempt} >= 1`),
    check(
      "training_attempts_outcome_check",
      sql`
      (${table.finishedAt} is null and ${table.outcome} is null and ${table.error} is null)
      or (${table.finishedAt} is not null and ${table.outcome} is not null and
        case ${table.outcome}
          when 'failed' then ${table.error} is not null and length(${table.error}) between 1 and 2000
          when 'succeeded' then ${table.error} is null
          when 'paused' then ${table.error} is null
          when 'cancelled' then ${table.error} is null
          when 'expired' then ${table.error} is null
          else false
        end)
    `,
    ),
  ],
);

/** Epoch history belongs to the execution attempt that reported it. */
export const trainingEpochs = pgTable(
  "training_epochs",
  {
    runId: text("run_id")
      .notNull()
      .references(() => trainingRuns.id),
    attempt: integer("attempt").notNull(),
    epoch: integer("epoch").notNull(),
    recordedAt: instant("recorded_at"),
    trainBoxLoss: doublePrecision("train_box_loss").notNull(),
    trainClassificationLoss: doublePrecision(
      "train_classification_loss",
    ).notNull(),
    trainRegressionLoss: doublePrecision("train_regression_loss").notNull(),
    valBoxLoss: doublePrecision("val_box_loss").notNull(),
    valClassificationLoss: doublePrecision("val_classification_loss").notNull(),
    valRegressionLoss: doublePrecision("val_regression_loss").notNull(),
    precision: doublePrecision("precision").notNull(),
    recall: doublePrecision("recall").notNull(),
    map50: doublePrecision("map50").notNull(),
    map50To95: doublePrecision("map50_95").notNull(),
    fitness: doublePrecision("fitness").notNull(),
    learningRate: doublePrecision("learning_rate").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.attempt, table.epoch] }),
    check(
      "training_epochs_order_check",
      sql`${table.attempt} >= 1 and ${table.epoch} >= 1`,
    ),
  ],
);

/** Frozen definitions and separate AI proposals; only accepted annotations train. */
export const annotationRuns = pgTable(
  "annotation_runs",
  {
    id: text("id").primaryKey(),
    imageId: text("image_id")
      .notNull()
      .references(() => images.id),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id),
    definition: jsonb("definition").$type<AnnotationDefinition>().notNull(),
    status: text("status", { enum: ANNOTATION_RUN_STATUSES }).notNull(),
    completed: integer("completed").notNull().default(0),
    total: integer("total").notNull(),
    createdAt: instant("created_at"),
    updatedAt: instant("updated_at"),
    result: jsonb("result").$type<AnnotationContent>(),
    /** The instances per class the result proposes; null until the run succeeds. */
    tally: jsonb("tally")
      .$type<Tally>()
      .generatedAlwaysAs(sql`document_tally(result->'document')`),
  },
  (table) => [
    index("annotation_runs_image_model_idx").on(
      table.imageId,
      table.modelId,
      table.createdAt,
    ),
    uniqueIndex("annotation_runs_active_idx")
      .on(table.imageId, table.modelId)
      .where(sql`${table.status} = 'running'`),
    check(
      "annotation_runs_status_check",
      sql`${table.status} in ('running', 'succeeded', 'cancelled')`,
    ),
    check(
      "annotation_runs_progress_check",
      sql`${table.completed} >= 0 and ${table.total} > 0 and ${table.completed} <= ${table.total}`,
    ),
    check(
      "annotation_runs_result_check",
      sql`(${table.status} = 'succeeded') = (${table.result} is not null)`,
    ),
  ],
);

/** Each region of a run, with the proposal accepted for it. */
export const annotationTasks = pgTable(
  "annotation_tasks",
  {
    runId: text("run_id")
      .notNull()
      .references(() => annotationRuns.id, { onDelete: "cascade" }),
    taskId: text("task_id").notNull(),
    region: jsonb("region").$type<ImageRegion>().notNull(),
    response: jsonb("response").$type<RegionProposal>(),
    acceptedProposalId: text("accepted_proposal_id"),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.taskId] }),
    unique("annotation_tasks_identifier_unique").on(table.taskId),
    check(
      "annotation_tasks_acceptance_check",
      sql`(${table.response} is null) = (${table.acceptedProposalId} is null)`,
    ),
  ],
);

/** Immutable proposals previewed for a region; submission accepts one of them. */
export const annotationPreviews = pgTable(
  "annotation_previews",
  {
    runId: text("run_id")
      .notNull()
      .references(() => annotationRuns.id, { onDelete: "cascade" }),
    taskId: text("task_id").notNull(),
    proposalId: text("proposal_id").notNull(),
    response: jsonb("response").$type<RegionProposal>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.taskId, table.proposalId] }),
    foreignKey({
      columns: [table.runId, table.taskId],
      foreignColumns: [annotationTasks.runId, annotationTasks.taskId],
    }).onDelete("cascade"),
  ],
);
