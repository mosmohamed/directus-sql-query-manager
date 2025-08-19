export default {
  id: 'sql-query-manager',
  handler: (router, { services, exceptions, database }) => {
    const { ItemsService, PermissionsService } = services;
    const { ServiceUnavailableException, ForbiddenException } = exceptions;

    // Middleware to check permissions
    const checkPermission = async (req, res, next) => {
      try {
        const permissionsService = new PermissionsService({
          accountability: req.accountability,
          schema: req.schema,
        });

        // Check if user has admin role or specific permission
        if (!req.accountability?.admin) {
          const permissions = await permissionsService.readByQuery({
            filter: {
              role: { _eq: req.accountability?.role },
              action: { _eq: 'read' },
              collection: { _eq: 'sql_queries' },
            },
          });

          if (permissions.length === 0) {
            throw new ForbiddenException('You do not have permission to execute SQL queries');
          }
        }
        next();
      } catch (error) {
        res.status(403).json({ error: error.message });
      }
    };

    // Get all saved queries
    router.get('/', checkPermission, async (req, res) => {
      try {
        const queries = await database('sql_queries')
          .select('id', 'name', 'description', 'parameters', 'created_at')
          .where('is_active', true)
          .orderBy('name');

        res.json({ data: queries });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get single query by name or id
    router.get('/:identifier', checkPermission, async (req, res) => {
      try {
        const { identifier } = req.params;

        const query = await database('sql_queries')
          .where('id', identifier)
          .orWhere('name', identifier)
          .andWhere('is_active', true)
          .first();

        if (!query) {
          return res.status(404).json({ error: 'Query not found' });
        }

        res.json({ data: query });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Execute query by name or id
    router.post('/:identifier/execute', checkPermission, async (req, res) => {
      const startTime = Date.now();
      let queryLog = {
        executed_by: req.accountability?.user || 'anonymous',
        parameters_used: req.body.parameters || {},
        status: 'success',
      };

      try {
        const { identifier } = req.params;
        const { parameters = {} } = req.body;

        // Fetch the query
        const savedQuery = await database('sql_queries')
          .where('id', identifier)
          .orWhere('name', identifier)
          .andWhere('is_active', true)
          .first();

        if (!savedQuery) {
          return res.status(404).json({ error: 'Query not found' });
        }

        queryLog.query_id = savedQuery.id;

        // Process parameters in the query
        let processedQuery = savedQuery.query;

        // Replace named parameters like :param_name
        for (const [key, value] of Object.entries(parameters)) {
          // Escape value to prevent SQL injection
          const escapedValue = database.raw('?', [value]).toString();
          processedQuery = processedQuery.replace(
            new RegExp(`:${key}\\b`, 'g'),
            escapedValue
          );
        }

        // Execute the query
        const result = await database.raw(processedQuery);

        // Handle different database response formats
        let data = result;
        if (result.rows) {
          // PostgreSQL
          data = result.rows;
          queryLog.rows_affected = result.rowCount;
        } else if (Array.isArray(result[0])) {
          // MySQL
          data = result[0];
          queryLog.rows_affected = result[0].length;
        } else {
          // SQLite and others
          queryLog.rows_affected = data.length;
        }

        queryLog.execution_time_ms = Date.now() - startTime;

        // Log successful execution
        await database('sql_query_logs').insert(queryLog);

        res.json({
          success: true,
          data: data,
          metadata: {
            query_name: savedQuery.name,
            execution_time_ms: queryLog.execution_time_ms,
            rows_affected: queryLog.rows_affected,
          },
        });
      } catch (error) {
        queryLog.status = 'error';
        queryLog.error_message = error.message;
        queryLog.execution_time_ms = Date.now() - startTime;

        // Log failed execution
        await database('sql_query_logs').insert(queryLog);

        res.status(500).json({
          success: false,
          error: error.message,
          metadata: {
            execution_time_ms: queryLog.execution_time_ms,
          },
        });
      }
    });

    // Create new query
    router.post('/', checkPermission, async (req, res) => {
      try {
        const { name, query, description, parameters } = req.body;

        if (!name || !query) {
          return res.status(400).json({ error: 'Name and query are required' });
        }

        const newQuery = await database('sql_queries')
          .insert({
            name,
            query,
            description,
            parameters: JSON.stringify(parameters || {}),
            created_by: req.accountability?.user || 'anonymous',
          })
          .returning('*');

        res.json({ data: newQuery[0] });
      } catch (error) {
        if (error.code === '23505' || error.code === 'SQLITE_CONSTRAINT') {
          res.status(409).json({ error: 'A query with this name already exists' });
        } else {
          res.status(500).json({ error: error.message });
        }
      }
    });

    // Update query
    router.patch('/:id', checkPermission, async (req, res) => {
      try {
        const { id } = req.params;
        const { name, query, description, parameters, is_active } = req.body;

        const updated = await database('sql_queries')
          .where('id', id)
          .update({
            ...(name && { name }),
            ...(query && { query }),
            ...(description !== undefined && { description }),
            ...(parameters && { parameters: JSON.stringify(parameters) }),
            ...(is_active !== undefined && { is_active }),
            updated_at: database.fn.now(),
          })
          .returning('*');

        if (updated.length === 0) {
          return res.status(404).json({ error: 'Query not found' });
        }

        res.json({ data: updated[0] });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Delete query (soft delete)
    router.delete('/:id', checkPermission, async (req, res) => {
      try {
        const { id } = req.params;

        const updated = await database('sql_queries')
          .where('id', id)
          .update({
            is_active: false,
            updated_at: database.fn.now(),
          });

        if (updated === 0) {
          return res.status(404).json({ error: 'Query not found' });
        }

        res.json({ success: true, message: 'Query deleted successfully' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get query execution logs
    router.get('/:id/logs', checkPermission, async (req, res) => {
      try {
        const { id } = req.params;
        const { limit = 50, offset = 0 } = req.query;

        const logs = await database('sql_query_logs')
          .where('query_id', id)
          .orderBy('executed_at', 'desc')
          .limit(limit)
          .offset(offset);

        res.json({ data: logs });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  },
};