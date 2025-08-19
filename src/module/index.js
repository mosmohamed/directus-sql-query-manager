import { defineModule } from '@directus/extensions-sdk';
import ModuleComponent from './routes.vue';

export default defineModule({
  id: 'sql-query-manager',
  name: 'SQL Query Manager',
  icon: 'database',
  routes: [
    {
      path: '',
      component: ModuleComponent,
    },
  ],
  preRegisterCheck(user) {
    // Only show module to admin users
    return user.role.admin_access === true;
  },
});