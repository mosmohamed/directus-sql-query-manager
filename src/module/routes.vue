<template>
  <private-view title="SQL Query Manager">
    <template #headline>
      <v-breadcrumb :items="breadcrumb" />
    </template>

    <template #title-outer:prepend>
      <v-button class="header-icon" rounded disabled icon secondary>
        <v-icon name="database" />
      </v-button>
    </template>

    <template #actions>
      <v-button v-tooltip.bottom="'Create New Query'" rounded icon @click="showCreateDialog = true">
        <v-icon name="add" />
      </v-button>
    </template>

    <template #navigation>
      <navigation-tabs v-model="currentTab" :tabs="tabs" />
    </template>

    <div class="sql-query-manager">
      <div v-if="currentTab === 'queries'" class="queries-section">
        <query-list
          :queries="queries"
          @execute="executeQuery"
          @edit="editQuery"
          @delete="deleteQuery"
          :loading="loading"
        />
      </div>

      <div v-if="currentTab === 'logs'" class="logs-section">
        <logs-viewer :logs="logs" :loading="loadingLogs" />
      </div>
    </div>

    <!-- Create/Edit Dialog -->
    <v-dialog v-model="showCreateDialog" @esc="showCreateDialog = false">
      <v-card>
        <v-card-title>
          {{ editingQuery ? 'Edit Query' : 'Create New Query' }}
        </v-card-title>

        <v-card-text>
          <v-form v-model="formValid">
            <v-input
              v-model="queryForm.name"
              placeholder="Query Name"
              :rules="[required]"
            />

            <v-textarea
              v-model="queryForm.description"
              placeholder="Description (optional)"
              :rows="3"
            />

            <v-textarea
              v-model="queryForm.query"
              placeholder="SQL Query"
              font="monospace"
              :rules="[required]"
              :rows="10"
            />

            <v-notice type="info">
              Use :parameter_name syntax for parameters. Example: WHERE id = :user_id
            </v-notice>
          </v-form>
        </v-card-text>

        <v-card-actions>
          <v-button secondary @click="showCreateDialog = false">
            Cancel
          </v-button>
          <v-button :loading="saving" :disabled="!formValid" @click="saveQuery">
            {{ editingQuery ? 'Update' : 'Create' }}
          </v-button>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Execute Dialog -->
    <v-dialog v-model="showExecuteDialog" @esc="showExecuteDialog = false">
      <v-card>
        <v-card-title>Execute Query: {{ executingQuery?.name }}</v-card-title>

        <v-card-text>
          <div v-if="queryParameters.length > 0">
            <h4>Parameters:</h4>
            <v-form>
              <v-input
                v-for="param in queryParameters"
                :key="param"
                v-model="parameterValues[param]"
                :placeholder="param"
              />
            </v-form>
          </div>

          <div v-if="queryResult" class="query-result">
            <h4>Result:</h4>
            <v-table :headers="resultHeaders" :items="queryResult" />
          </div>

          <v-notice v-if="queryError" type="danger">
            {{ queryError }}
          </v-notice>
        </v-card-text>

        <v-card-actions>
          <v-button secondary @click="showExecuteDialog = false">
            Close
          </v-button>
          <v-button :loading="executing" @click="runQuery">
            Execute
          </v-button>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </private-view>
</template>

<script>
import { ref, computed, onMounted } from 'vue';
import { useApi } from '@directus/extensions-sdk';

export default {
  setup() {
    const api = useApi();

    const currentTab = ref('queries');
    const queries = ref([]);
    const logs = ref([]);
    const loading = ref(false);
    const loadingLogs = ref(false);
    const saving = ref(false);
    const executing = ref(false);

    const showCreateDialog = ref(false);
    const showExecuteDialog = ref(false);

    const queryForm = ref({
      name: '',
      description: '',
      query: '',
    });

    const editingQuery = ref(null);
    const executingQuery = ref(null);
    const parameterValues = ref({});
    const queryResult = ref(null);
    const queryError = ref(null);
    const formValid = ref(false);

    const tabs = [
      { text: 'Queries', value: 'queries' },
      { text: 'Execution Logs', value: 'logs' },
    ];

    const breadcrumb = [
      { name: 'SQL Query Manager', to: '/sql-query-manager' },
    ];

    const required = (value) => !!value || 'This field is required';

    const queryParameters = computed(() => {
      if (!executingQuery.value) return [];
      const matches = executingQuery.value.query.match(/:(\w+)/g);
      return matches ? matches.map(m => m.substring(1)) : [];
    });

    const resultHeaders = computed(() => {
      if (!queryResult.value || queryResult.value.length === 0) return [];
      return Object.keys(queryResult.value[0]).map(key => ({
        text: key,
        value: key,
      }));
    });

    const fetchQueries = async () => {
      loading.value = true;
      try {
        const response = await api.get('/sql-query-manager');
        queries.value = response.data.data;
      } catch (error) {
        console.error('Failed to fetch queries:', error);
      } finally {
        loading.value = false;
      }
    };

    const fetchLogs = async () => {
      loadingLogs.value = true;
      try {
        // Fetch logs for all queries
        const response = await api.get('/sql-query-manager/logs');
        logs.value = response.data.data;
      } catch (error) {
        console.error('Failed to fetch logs:', error);
      } finally {
        loadingLogs.value = false;
      }
    };

    const saveQuery = async () => {
      saving.value = true;
      try {
        if (editingQuery.value) {
          await api.patch(`/sql-query-manager/${editingQuery.value.id}`, queryForm.value);
        } else {
          await api.post('/sql-query-manager', queryForm.value);
        }

        showCreateDialog.value = false;
        editingQuery.value = null;
        queryForm.value = { name: '', description: '', query: '' };
        await fetchQueries();
      } catch (error) {
        console.error('Failed to save query:', error);
      } finally {
        saving.value = false;
      }
    };

    const executeQuery = (query) => {
      executingQuery.value = query;
      parameterValues.value = {};
      queryResult.value = null;
      queryError.value = null;
      showExecuteDialog.value = true;
    };

    const runQuery = async () => {
      executing.value = true;
      queryError.value = null;

      try {
        const response = await api.post(
          `/sql-query-manager/${executingQuery.value.id}/execute`,
          { parameters: parameterValues.value }
        );

        if (response.data.success) {
          queryResult.value = response.data.data;
        } else {
          queryError.value = response.data.error;
        }
      } catch (error) {
        queryError.value = error.message;
      } finally {
        executing.value = false;
      }
    };

    const editQuery = (query) => {
      editingQuery.value = query;
      queryForm.value = {
        name: query.name,
        description: query.description,
        query: query.query,
      };
      showCreateDialog.value = true;
    };

    const deleteQuery = async (query) => {
      if (!confirm(`Are you sure you want to delete "${query.name}"?`)) return;

      try {
        await api.delete(`/sql-query-manager/${query.id}`);
        await fetchQueries();
      } catch (error) {
        console.error('Failed to delete query:', error);
      }
    };

    onMounted(() => {
      fetchQueries();
      fetchLogs();
    });

    return {
      currentTab,
      queries,
      logs,
      loading,
      loadingLogs,
      saving,
      executing,
      showCreateDialog,
      showExecuteDialog,
      queryForm,
      editingQuery,
      executingQuery,
      parameterValues,
      queryResult,
      queryError,
      formValid,
      tabs,
      breadcrumb,
      required,
      queryParameters,
      resultHeaders,
      saveQuery,
      executeQuery,
      runQuery,
      editQuery,
      deleteQuery,
    };
  },
};
</script>

<style scoped>
.sql-query-manager {
  padding: var(--content-padding);
}

.queries-section,
.logs-section {
  background: var(--background-page);
  border-radius: var(--border-radius);
  padding: 20px;
}

.query-result {
  margin-top: 20px;
  max-height: 400px;
  overflow: auto;
}

.header-icon {
  --v-button-background-color: var(--primary-10);
  --v-button-color: var(--primary);
  --v-button-background-color-hover: var(--primary-25);
  --v-button-color-hover: var(--primary);
}
</style>