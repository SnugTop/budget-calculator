import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Plan } from '../shared/types';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  token: text('token').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
});

/**
 * One row per plan: each profile has exactly one live plan and any number of
 * what-if copies. The whole plan is stored as one JSON document.
 */
export const plans = sqliteTable('plans', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isLive: integer('is_live', { mode: 'boolean' }).notNull(),
  data: text('data', { mode: 'json' }).$type<Plan>().notNull(),
  /** Goes up by one on every save, so two devices cannot silently overwrite each other. */
  version: integer('version').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
});
