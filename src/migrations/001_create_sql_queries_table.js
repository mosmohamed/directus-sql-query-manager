module.exports = {
  async up(knex) {
    await knex.schema.createTable('sql_queries', (table) => {
      table.uuid('id').primary().defaultTo(knex.fn.uuid());
      table.string('name').notNullable().unique();
      table.text('query').notNullable();
      table.text('description');
      table.json('parameters'); // Store parameter definitions
      table.boolean('is_active').defaultTo(true);
      table.string('created_by');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });

    // Create audit log table
    await knex.schema.createTable('sql_query_logs', (table) => {
      table.uuid('id').primary().defaultTo(knex.fn.uuid());
      table.uuid('query_id').references('id').inTable('sql_queries');
      table.string('executed_by');
      table.json('parameters_used');
      table.integer('execution_time_ms');
      table.integer('rows_affected');
      table.text('error_message');
      table.string('status'); // 'success' or 'error'
      table.timestamp('executed_at').defaultTo(knex.fn.now());
    });
  },

  async down(knex) {
    await knex.schema.dropTableIfExists('sql_query_logs');
    await knex.schema.dropTableIfExists('sql_queries');
  }
};