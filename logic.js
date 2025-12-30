/**
 * FinancePro - Finance Management Application
 * Core Logic with Offline-First Architecture
 */

// ============================================================================
// UTILITY FUNCTIONS (GLOBAL SCOPE)
// ============================================================================

function formatAmount(amount) {
  return new Intl.NumberFormat('nl-NL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function showToast(message, type = 'success') {
  if (!window.app) return;

  const toast = {
    id: Date.now(),
    message,
    type
  };

  window.app.toasts.push(toast);

  // Auto remove after 4 seconds
  setTimeout(() => {
    const index = window.app.toasts.findIndex(t => t.id === toast.id);
    if (index > -1) {
      window.app.toasts.splice(index, 1);
    }
  }, 4000);
}

// ============================================================================
// CONFIGURATION & INITIALIZATION
// ============================================================================

const APP_NAME = 'financepro';
const CLIENT_ID = 'sandman'; // In productie zou dit dynamisch zijn
const API_URL = 'http://10.10.2.20:5000'; // Aanpassen naar juiste server URL

let manager = null;
let app = null;

// Make app globally accessible for utility functions
window.app = null;

// Theme configuration is now in Vue data

// ============================================================================
// OFFLINE MANAGER INTEGRATION
// ============================================================================

async function initializeOfflineManager() {
  try {
    manager = new OfflineManager(API_URL, CLIENT_ID, APP_NAME);

    // Set up event listeners
    manager.onSyncChange = (pendingCount) => {
      console.log(`[FinancePro] Sync status: ${pendingCount} pending operations`);
      if (app) {
        app.syncStatus = pendingCount > 0 ? 'syncing' : 'synced';
      }
    };

    manager.onDataChanged = () => {
      console.log('[FinancePro] Data changed, refreshing UI');
      if (app) {
        app.refreshData();
      }
    };

    // Set up online/offline detection
    window.addEventListener('online', () => {
      console.log('[FinancePro] Back online, syncing...');
      if (app) app.dbConnected = true;
      manager.syncOutbox();
      manager.refreshCache('transactions');
      manager.refreshCache('categories');
      manager.refreshCache('rules');
    });

    window.addEventListener('offline', () => {
      console.log('[FinancePro] Gone offline');
      if (app) app.dbConnected = false;
    });

    // Periodic refresh (every 60 seconds)
    setInterval(() => {
      if (navigator.onLine && !manager.isOfflineSimulated) {
        manager.refreshCache('transactions');
        manager.refreshCache('categories');
        manager.refreshCache('rules');
      }
    }, 60000);

    // Focus-based refresh
    window.addEventListener('focus', () => {
      if (navigator.onLine && !manager.isOfflineSimulated) {
        manager.refreshCache('transactions');
        manager.refreshCache('categories');
        manager.refreshCache('rules');
      }
    });

    console.log('[FinancePro] Offline manager initialized successfully');
    return true;
  } catch (error) {
    console.error('[FinancePro] Failed to initialize offline manager:', error);
    showToast('Fout bij initialisatie van offline manager', 'error');
    return false;
  }
}

// ============================================================================
// VUE APPLICATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize offline manager first
  const initialized = await initializeOfflineManager();
  if (!initialized) {
    return;
  }

  // Initialize Vue app
  app = Vue.createApp({
    data() {
      return {
        // Authentication
        isAuthenticated: false,
        loginForm: { username: '' },
        isLoading: false,
        loginError: '',

        // Navigation
        currentPage: 'dashboard',
        showMobileMenu: false,

        // Connection status
        dbConnected: navigator.onLine,
        syncStatus: 'synced',
        isOfflineMode: false,

        // Settings
        showSettingsModal: false,
        settings: {
          themeColor: 'indigo'
        },
        themeColors: [
          { val: 'indigo', rgb: '99, 102, 241' },
          { val: 'blue', rgb: '59, 130, 246' },
          { val: 'green', rgb: '16, 185, 129' },
          { val: 'purple', rgb: '139, 92, 246' },
          { val: 'red', rgb: '239, 68, 68' },
          { val: 'orange', rgb: '249, 115, 22' }
        ],

        // Data
        transactions: [],
        categories: [],
        rules: [],

        // UI State
        showTransactionModal: false,
        showCategoryModal: false,
        showRuleModal: false,
        showBulkEditModal: false,
        showCsvImportModal: false,

        // Forms
        transactionForm: {
          date: new Date().toISOString().split('T')[0],
          name: '',
          description: '',
          amount: '',
          account: '',
          category: ''
        },
        categoryForm: {
          name: '',
          color: '#6366f1'
        },
        ruleForm: {
          name: '',
          condition: {
            field: 'description',
            operator: 'contains',
            value: ''
          },
          action: {
            type: 'set_category',
            value: ''
          }
        },
        bulkEditForm: {
          category: '',
          name: '',
          description: '',
          account: ''
        },
        csvMapping: {
          date: '',
          name: '',
          description: '',
          amount: '',
          balance: '',
          account: '',
          category: '',
          delimiter: ','
        },

        // Column visibility settings
        columnVisibility: {
          date: true,
          name: true,
          description: true,
          account: true,
          category: true,
          amount: true,
          balance: false
        },

        // Editing state
        editingTransaction: null,
        editingCategory: null,
        editingRule: null,

        // Filters & Search
        transactionFilters: {
          search: '',
          category: '',
          type: '',
          period: ''
        },
        selectedTransactions: [],

        // CSV Import
        csvPreview: [],
        selectedCsvFile: null,
        csvColumns: [],

        // Column settings
        toggleColumnSettings: false,

        // Account filter
        selectedAccount: '',
        showAccountFilter: false,

        // Time range filter
        selectedTimeRange: 'last_12_months',
        showTimeRangeFilter: false,

        // Dashboard data
        monthlyExpenses: 0,
        monthlyIncome: 0,
        monthlyBalance: 0,
        recentTransactions: [],

        // Insights data
        topSpendingCategories: [],

        // Toast notifications
        toasts: []
      };
    },

    computed: {
      // Filtered transactions
      filteredTransactions() {
        let filtered = [...this.transactions];

        // Search filter
        if (this.transactionFilters.search) {
          const search = this.transactionFilters.search.toLowerCase();
          filtered = filtered.filter(t =>
            t.description.toLowerCase().includes(search) ||
            t.category.toLowerCase().includes(search)
          );
        }

        // Category filter
        if (this.transactionFilters.category) {
          filtered = filtered.filter(t => t.category === this.transactionFilters.category);
        }

        // Type filter
        if (this.transactionFilters.type) {
          if (this.transactionFilters.type === 'income') {
            filtered = filtered.filter(t => t.amount >= 0);
          } else if (this.transactionFilters.type === 'expense') {
            filtered = filtered.filter(t => t.amount < 0);
          }
        }

        // Period filter
        if (this.transactionFilters.period) {
          const now = new Date();
          let startDate;

          switch (this.transactionFilters.period) {
            case 'this_month':
              startDate = new Date(now.getFullYear(), now.getMonth(), 1);
              break;
            case 'last_month':
              startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
              break;
            case 'this_year':
              startDate = new Date(now.getFullYear(), 0, 1);
              break;
            case 'last_year':
              startDate = new Date(now.getFullYear() - 1, 0, 1);
              break;
          }

          if (startDate) {
            filtered = filtered.filter(t => new Date(t.date) >= startDate);
          }
        }

        // Account filter
        if (this.selectedAccount) {
          filtered = filtered.filter(t => t.account === this.selectedAccount);
        }

        // Sort by date (newest first)
        filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

        return filtered;
      },

      // Select all checkbox state
      selectAllTransactions: {
        get() {
          return this.filteredTransactions.length > 0 &&
                 this.selectedTransactions.length === this.filteredTransactions.length;
        },
        set(value) {
          if (value) {
            this.selectedTransactions = this.filteredTransactions.map(t => t.id);
          } else {
            this.selectedTransactions = [];
          }
        }
      },

      // Details page data
      categoryMonthlyData() {
        return this.getCategoryMonthlyData();
      },

      incomeData() {
        return this.getIncomeData();
      },

      expenseData() {
        return this.getExpenseData();
      },

      // Available accounts for filtering
      availableAccounts() {
        const accounts = [...new Set(this.transactions.map(t => t.account).filter(account => account && account.trim()))];
        return accounts.sort();
      },

      // Time range options
      timeRangeOptions() {
        return [
          { value: 'this_month', label: 'Deze maand' },
          { value: 'last_month', label: 'Vorige maand' },
          { value: 'last_6_months', label: 'Laatste 6 maanden' },
          { value: 'last_12_months', label: 'Laatste 12 maanden' }
        ];
      },

      // Check if we should use compact table mode (12 months)
      isCompactTableMode() {
        return this.selectedTimeRange === 'last_12_months' &&
               (this.incomeData?.months?.length === 12 || this.expenseData?.months?.length === 12);
      },

      // Category statistics for insights table
      categoryStatistics() {
        return this.getCategoryStatistics();
      },

      // Left and right category groups for dashboard
      leftCategoryGroups() {
        const groups = this.groupTransactionsByCategory();
        return groups.slice(0, Math.ceil(groups.length / 2));
      },

      rightCategoryGroups() {
        const groups = this.groupTransactionsByCategory();
        return groups.slice(Math.ceil(groups.length / 2));
      }
    },

    beforeUnmount() {
      // Clean up charts when component is destroyed
      if (this.monthlyExpensesChart) {
        this.monthlyExpensesChart.destroy();
      }
      if (this.monthlyTrendChart) {
        this.monthlyTrendChart.destroy();
      }
      if (this.categoryPieChart) {
        this.categoryPieChart.destroy();
      }
      if (this.incomeExpenseChart) {
        this.incomeExpenseChart.destroy();
      }
      if (this.accountBalanceChart) {
        this.accountBalanceChart.destroy();
      }
    },

    methods: {
      // ============================================================================
      // AUTHENTICATION
      // ============================================================================

      async login() {
        if (!this.loginForm.username.trim()) {
          this.loginError = 'Voer een client ID in';
          return;
        }

        this.isLoading = true;
        this.loginError = '';

        try {
          // In a real app, this would validate against the server
          this.isAuthenticated = true;
          await this.refreshData();
          showToast('Succesvol ingelogd', 'success');
        } catch (error) {
          console.error('Login error:', error);
          this.loginError = 'Login mislukt. Controleer je client ID.';
        } finally {
          this.isLoading = false;
        }
      },

      logout() {
        this.isAuthenticated = false;
        this.currentPage = 'dashboard';
        this.showSettingsModal = false;
        this.transactions = [];
        this.categories = [];
        this.rules = [];
        showToast('Uitgelogd', 'success');
      },


      // ============================================================================
      // DATA MANAGEMENT
      // ============================================================================

      async refreshData() {
        try {
          const [transactions, categories, rules] = await Promise.all([
            manager.getSmartCollection('transactions'),
            manager.getSmartCollection('categories'),
            manager.getSmartCollection('rules')
          ]);

          this.transactions = transactions || [];
          this.categories = categories || [];
          this.rules = rules || [];

          // Calculate category statistics
          this.updateCategoryStats();

          // No default categories or demo data

          // Apply rules to existing transactions
          await this.applyRulesToTransactions();

          // Update dashboard data
          this.updateDashboardData();

          // Update insights data (only if we're on the insights page)
          if (this.currentPage === 'insights') {
            this.updateInsightsData();
          }

          console.log(`[FinancePro] Data refreshed: ${this.transactions.length} transactions, ${this.categories.length} categories, ${this.rules.length} rules`);
        } catch (error) {
          console.error('[FinancePro] Error refreshing data:', error);
          showToast('Fout bij het laden van data', 'error');
        }
      },



      // ============================================================================
      // NAVIGATION
      // ============================================================================

      changePage(page) {
        console.log('Changing page to:', page);
        this.currentPage = page;
        this.showMobileMenu = false;

        // Update insights data when navigating to insights page
        if (page === 'insights') {
          console.log('Updating insights data...');
          this.updateInsightsData();
        }

        // Render dashboard chart when navigating to dashboard page
        if (page === 'dashboard') {
          this.$nextTick(() => {
            setTimeout(() => {
              this.renderMonthlyExpensesChart();
            }, 100);
          });
        }

        // Update details data when navigating to details page
        if (page === 'details') {
          console.log('Details page accessed');
          // Details data is computed and doesn't need manual refresh
        }
      },

      // ============================================================================
      // ACCOUNT FILTERING
      // ============================================================================

      setSelectedAccount(account) {
        this.selectedAccount = account;
        this.showAccountFilter = false;
        // Reset selected transactions when changing account filter
        this.selectedTransactions = [];

        // Refresh data when account filter changes
        if (this.currentPage === 'insights') {
          this.updateInsightsData();
        } else if (this.currentPage === 'details') {
          // Force update of computed properties
          this.$forceUpdate();
        }
      },

      setSelectedTimeRange(timeRange) {
        this.selectedTimeRange = timeRange;
        this.showTimeRangeFilter = false;

        // Refresh data when time range changes
        if (this.currentPage === 'insights') {
          this.updateInsightsData();
        } else if (this.currentPage === 'details') {
          // Force update of computed properties
          this.$forceUpdate();
        }
      },

      getTimeRangeFilter() {
        const now = new Date();
        let startDate, endDate;

        switch (this.selectedTimeRange) {
          case 'this_month':
            // Deze maand: van begin huidige maand tot vandaag
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
            break;
          case 'last_month':
            // Vorige maand: volledige vorige maand
            const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            startDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1);
            endDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0, 23, 59, 59);
            break;
          case 'last_6_months':
            startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
            endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
            break;
          case 'last_12_months':
          default:
            startDate = new Date(now.getFullYear(), now.getMonth() - 12, 1);
            endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
            break;
        }

        return { startDate, endDate };
      },

      // Truncate category names for compact display
      truncateCategoryName(name, maxLength = 15) {
        if (!name) return '';
        return name.length > maxLength ? name.substring(0, maxLength) + '...' : name;
      },

      refreshDetailsData() {
        // Force recalculation of details data by triggering Vue reactivity
        console.log('Refreshing details data...');
        this.$forceUpdate();

        // Show success message
        showToast('Details overzicht vernieuwd', 'success');
      },

      // ============================================================================
      // SETTINGS
      // ============================================================================

      setThemeColor(color) {
        this.settings.themeColor = color.val;
        document.documentElement.setAttribute('data-theme', color.val);
        localStorage.setItem('financepro_theme', color.val);
      },

      toggleOfflineMode() {
        this.isOfflineMode = !this.isOfflineMode;
        manager.isOfflineSimulated = this.isOfflineMode;
        if (!this.isOfflineMode && navigator.onLine) {
          manager.syncOutbox();
        }
        showToast(this.isOfflineMode ? 'Offline modus ingeschakeld' : 'Online modus ingeschakeld', 'success');
      },

      // ============================================================================
      // DASHBOARD METHODS
      // ============================================================================

      updateDashboardData() {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        // Calculate monthly totals
        let monthlyIncome = 0;
        let monthlyExpenses = 0;

        this.transactions.forEach(transaction => {
          const transactionDate = new Date(transaction.date);
          if (transactionDate.getMonth() === currentMonth && transactionDate.getFullYear() === currentYear) {
            if (transaction.amount >= 0) {
              monthlyIncome += transaction.amount;
            } else {
              monthlyExpenses += Math.abs(transaction.amount);
            }
          }
        });

        this.monthlyIncome = monthlyIncome;
        this.monthlyExpenses = monthlyExpenses;
        this.monthlyBalance = monthlyIncome - monthlyExpenses;

        // Get recent transactions
        this.recentTransactions = [...this.transactions]
          .sort((a, b) => new Date(b.date) - new Date(a.date))
          .slice(0, 5);

        // Render dashboard chart if we're on dashboard page
        if (this.currentPage === 'dashboard') {
          this.$nextTick(() => {
            setTimeout(() => {
              this.renderMonthlyExpensesChart();
            }, 100);
          });
        }
      },

      groupTransactionsByCategory() {
        const categoryGroups = {};

        this.transactions.forEach(transaction => {
          if (!categoryGroups[transaction.category]) {
            const category = this.categories.find(c => c.name === transaction.category);
            categoryGroups[transaction.category] = {
              name: transaction.category,
              color: category ? category.color : '#6b7280',
              services: []
            };
          }
          categoryGroups[transaction.category].services.push(transaction);
        });

        return Object.values(categoryGroups);
      },

      getCategoryMonthlyData() {
        const now = new Date();
        const timeRangeFilter = this.getTimeRangeFilter();

        // Determine number of months based on time range
        let numMonths;
        switch (this.selectedTimeRange) {
          case 'this_month':
          case 'last_month':
            numMonths = 1;
            break;
          case 'last_6_months':
            numMonths = 6;
            break;
          case 'last_12_months':
          default:
            numMonths = 12; // Show all 12 months for last_12_months
            break;
        }

        const months = [];
        for (let i = numMonths - 1; i >= 0; i--) {
          const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
          months.push({
            month: date.getMonth(),
            year: date.getFullYear(),
            label: date.toLocaleDateString('nl-NL', { month: 'short', year: '2-digit' }),
            fullLabel: date.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })
          });
        }

        // Filter transactions by account if selected
        let filteredTransactions = this.selectedAccount
          ? this.transactions.filter(t => t.account === this.selectedAccount)
          : this.transactions;

        // Apply time range filter
        filteredTransactions = filteredTransactions.filter(t => {
          const transactionDate = new Date(t.date);
          return transactionDate >= timeRangeFilter.startDate && transactionDate <= timeRangeFilter.endDate;
        });

        // Get all categories
        const categories = [...new Set(filteredTransactions.map(t => t.category))].sort();

        // Create data structure: category -> month -> total
        const data = {};

        categories.forEach(category => {
          data[category] = {};

          months.forEach(month => {
            const monthTransactions = filteredTransactions.filter(t => {
              const transactionDate = new Date(t.date);
              return transactionDate.getMonth() === month.month &&
                     transactionDate.getFullYear() === month.year &&
                     t.category === category;
            });

            const total = monthTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
            data[category][month.label] = total;
          });

          // Add total column
          const categoryTotal = months.reduce((sum, month) => sum + data[category][month.label], 0);
          data[category].total = categoryTotal;
        });

        return {
          months: months || [],
          categories: categories || [],
          data: data || {}
        };
      },

      getIncomeData() {
        const now = new Date();
        const timeRangeFilter = this.getTimeRangeFilter();

        // Determine number of months based on time range
        let numMonths;
        switch (this.selectedTimeRange) {
          case 'this_month':
          case 'last_month':
            numMonths = 1;
            break;
          case 'last_6_months':
            numMonths = 6;
            break;
          case 'last_12_months':
          default:
            numMonths = 12; // Show all 12 months for last_12_months
            break;
        }

        const months = [];
        for (let i = numMonths - 1; i >= 0; i--) {
          const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
          months.push({
            month: date.getMonth(),
            year: date.getFullYear(),
            label: date.toLocaleDateString('nl-NL', { month: 'short', year: '2-digit' }),
            fullLabel: date.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })
          });
        }

        // Filter transactions by account if selected
        let filteredTransactions = this.selectedAccount
          ? this.transactions.filter(t => t.account === this.selectedAccount)
          : this.transactions;

        // Apply time range filter
        filteredTransactions = filteredTransactions.filter(t => {
          const transactionDate = new Date(t.date);
          return transactionDate >= timeRangeFilter.startDate && transactionDate <= timeRangeFilter.endDate;
        });

        // Get income categories (amount >= 0)
        const incomeTransactions = filteredTransactions.filter(t => t.amount >= 0);
        const categories = [...new Set(incomeTransactions.map(t => t.category))].sort();

        // Create data structure
        const data = {};

        categories.forEach(category => {
          data[category] = {};

          months.forEach(month => {
            const monthTransactions = incomeTransactions.filter(t => {
              const transactionDate = new Date(t.date);
              return transactionDate.getMonth() === month.month &&
                     transactionDate.getFullYear() === month.year &&
                     t.category === category;
            });

            const total = monthTransactions.reduce((sum, t) => sum + t.amount, 0);
            data[category][month.label] = total;
          });

          // Add total column
          const categoryTotal = months.reduce((sum, month) => sum + data[category][month.label], 0);
          data[category].total = categoryTotal;
        });

        return {
          months,
          categories: categories, // Include all categories including 'Not defined'
          data
        };
      },

      getExpenseData() {
        const now = new Date();
        const timeRangeFilter = this.getTimeRangeFilter();

        // Determine number of months based on time range
        let numMonths;
        switch (this.selectedTimeRange) {
          case 'this_month':
          case 'last_month':
            numMonths = 1;
            break;
          case 'last_6_months':
            numMonths = 6;
            break;
          case 'last_12_months':
          default:
            numMonths = 12; // Show all 12 months for last_12_months
            break;
        }

        const months = [];
        for (let i = numMonths - 1; i >= 0; i--) {
          const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
          months.push({
            month: date.getMonth(),
            year: date.getFullYear(),
            label: date.toLocaleDateString('nl-NL', { month: 'short', year: '2-digit' }),
            fullLabel: date.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })
          });
        }

        // Filter transactions by account if selected
        let filteredTransactions = this.selectedAccount
          ? this.transactions.filter(t => t.account === this.selectedAccount)
          : this.transactions;

        // Apply time range filter
        filteredTransactions = filteredTransactions.filter(t => {
          const transactionDate = new Date(t.date);
          return transactionDate >= timeRangeFilter.startDate && transactionDate <= timeRangeFilter.endDate;
        });

        // Get expense categories (amount < 0)
        const expenseTransactions = filteredTransactions.filter(t => t.amount < 0);
        const categories = [...new Set(expenseTransactions.map(t => t.category))].sort();

        // Create data structure
        const data = {};

        categories.forEach(category => {
          data[category] = {};

          months.forEach(month => {
            const monthTransactions = expenseTransactions.filter(t => {
              const transactionDate = new Date(t.date);
              return transactionDate.getMonth() === month.month &&
                     transactionDate.getFullYear() === month.year &&
                     t.category === category;
            });

            const total = monthTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
            data[category][month.label] = total;
          });

          // Add total column
          const categoryTotal = months.reduce((sum, month) => sum + data[category][month.label], 0);
          data[category].total = categoryTotal;
        });

        return {
          months,
          categories,
          data
        };
      },

      // ============================================================================
      // DETAILS PAGE HELPERS
      // ============================================================================

      getMonthlyIncomeTotal(month) {
        if (!this.incomeData || !this.incomeData.categories) {
          return 0;
        }
        return this.incomeData.categories.reduce((sum, category) => {
          return sum + (this.incomeData.data[category]?.[month.label] || 0);
        }, 0);
      },

      getIncomeGrandTotal() {
        if (!this.incomeData || !this.incomeData.categories) {
          return 0;
        }
        return this.incomeData.categories.reduce((sum, category) => {
          return sum + (this.incomeData.data[category]?.total || 0);
        }, 0);
      },

      getMonthlyExpenseTotal(month) {
        if (!this.expenseData || !this.expenseData.categories) {
          return 0;
        }
        return this.expenseData.categories.reduce((sum, category) => {
          return sum + (this.expenseData.data[category]?.[month.label] || 0);
        }, 0);
      },

      getExpenseGrandTotal() {
        if (!this.expenseData || !this.expenseData.categories) {
          return 0;
        }
        return this.expenseData.categories.reduce((sum, category) => {
          return sum + (this.expenseData.data[category]?.total || 0);
        }, 0);
      },

      getMonthlyNetResult(month) {
        return this.getMonthlyIncomeTotal(month) - this.getMonthlyExpenseTotal(month);
      },

      getNetGrandTotal() {
        return this.getIncomeGrandTotal() - this.getExpenseGrandTotal();
      },

      // ============================================================================
      // INSIGHTS METHODS
      // ============================================================================

      updateInsightsData() {
        console.log('updateInsightsData called, transactions:', this.transactions.length);
        this.calculateInsightsData();
      },

      calculateInsightsData() {
        // Calculate top spending categories
        const categoryTotals = {};

        // Filter transactions by account if selected
        let filteredTransactions = this.selectedAccount
          ? this.transactions.filter(t => t.account === this.selectedAccount)
          : this.transactions;

        // Apply time range filter
        const timeRangeFilter = this.getTimeRangeFilter();
        filteredTransactions = filteredTransactions.filter(t => {
          const transactionDate = new Date(t.date);
          return transactionDate >= timeRangeFilter.startDate && transactionDate <= timeRangeFilter.endDate;
        });

        filteredTransactions.forEach(transaction => {
          if (transaction.amount < 0) { // Only expenses
            const category = transaction.category;
            if (!categoryTotals[category]) {
              categoryTotals[category] = 0;
            }
            categoryTotals[category] += Math.abs(transaction.amount);
          }
        });

        const totalExpenses = Object.values(categoryTotals).reduce((sum, amount) => sum + amount, 0);

        this.topSpendingCategories = Object.entries(categoryTotals)
          .map(([name, amount]) => {
            const category = this.categories.find(c => c.name === name);
            return {
              name,
              amount,
              color: category ? category.color : '#6b7280',
              percentage: totalExpenses > 0 ? Math.round((amount / totalExpenses) * 100) : 0
            };
          })
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 5);

        // Update category statistics
        this.updateCategoryStats();

        // Update charts after a short delay to ensure DOM is ready
        this.$nextTick(() => {
          setTimeout(() => {
            this.renderCharts();
          }, 100);
        });
      },

      updateCategoryStats() {
        // Add transaction count and total amount to each category
        this.categories.forEach(category => {
          const categoryTransactions = this.transactions.filter(t => t.category === category.name);
          const currentYearTransactions = categoryTransactions.filter(t => {
            const transactionYear = new Date(t.date).getFullYear();
            return transactionYear === new Date().getFullYear();
          });

          category.transactionCount = categoryTransactions.length;

          // Calculate income and expense totals separately
          category.incomeTotal = currentYearTransactions
            .filter(t => t.amount >= 0)
            .reduce((sum, t) => sum + t.amount, 0);

          category.expenseTotal = Math.abs(currentYearTransactions
            .filter(t => t.amount < 0)
            .reduce((sum, t) => sum + t.amount, 0));

          // Keep totalAmount for backward compatibility (absolute value)
          category.totalAmount = currentYearTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
        });
      },

      renderCharts() {
        console.log('Rendering charts with', this.transactions.length, 'transactions');
        try {
          this.renderMonthlyExpensesChart();
          console.log('Monthly expenses chart rendered');
        } catch (error) {
          console.error('Error rendering monthly expenses chart:', error);
        }

        try {
          this.renderMonthlyTrendChart();
          console.log('Monthly trend chart rendered');
        } catch (error) {
          console.error('Error rendering monthly trend chart:', error);
        }

        try {
          this.renderCategoryPieChart();
          console.log('Category pie chart rendered');
        } catch (error) {
          console.error('Error rendering category pie chart:', error);
        }

        try {
          this.renderIncomeExpenseChart();
          console.log('Income expense chart rendered');
        } catch (error) {
          console.error('Error rendering income expense chart:', error);
        }

        try {
          this.renderAccountBalanceChart();
          console.log('Account balance chart rendered');
        } catch (error) {
          console.error('Error rendering account balance chart:', error);
        }
      },

      renderMonthlyExpensesChart() {
        console.log('=== RENDER MONTHLY EXPENSES CHART START ===');
        const ctx = document.getElementById('monthlyExpensesChart');
        if (!ctx) {
          console.log('Monthly expenses chart canvas not found');
          return;
        }

        console.log('Canvas element found:', ctx);
        console.log('Canvas dimensions:', ctx.width, 'x', ctx.height);
        console.log('Chart.js available:', typeof Chart);
        console.log('Chart constructor:', Chart);

        // Destroy existing chart if it exists
        if (this.monthlyExpensesChart) {
          this.monthlyExpensesChart.destroy();
        }

        const monthlyData = this.getMonthlyExpensesByCategory();
        console.log('Monthly data:', monthlyData);

        if (!monthlyData || !monthlyData.datasets || monthlyData.datasets.length === 0) {
          console.log('No data for monthly expenses chart, creating test chart');

          // Create a test chart to verify Chart.js works
          this.monthlyExpensesChart = new Chart(ctx, {
            type: 'bar',
            data: {
              labels: ['Jan', 'Feb', 'Mar'],
              datasets: [{
                label: 'Test Data',
                data: [10, 20, 30],
                backgroundColor: '#6366f1'
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false
            }
          });
          console.log('Test chart created successfully');
          return;
        }

        console.log('Creating real chart with data');
        this.monthlyExpensesChart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: monthlyData.labels,
            datasets: monthlyData.datasets
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: {
                stacked: true,
                ticks: { color: '#9ca3af' },
                grid: { color: '#374151' }
              },
              y: {
                stacked: true,
                ticks: {
                  color: '#9ca3af',
                  callback: (value) => '€' + formatAmount(value)
                },
                grid: { color: '#374151' }
              }
            },
            plugins: {
              legend: {
                labels: { color: '#9ca3af' }
              }
            }
          }
        });
      },

      renderMonthlyTrendChart() {
        const ctx = document.getElementById('monthlyTrendChart');
        if (!ctx) return;

        // Destroy existing chart if it exists
        if (this.monthlyTrendChart) {
          this.monthlyTrendChart.destroy();
        }

        const trendData = this.getMonthlyTrendData();

        this.monthlyTrendChart = new Chart(ctx, {
          type: 'line',
          data: {
            labels: trendData.labels,
            datasets: trendData.datasets
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
              y: {
                ticks: {
                  color: '#9ca3af',
                  callback: (value) => '€' + formatAmount(value)
                },
                grid: { color: '#374151' }
              }
            },
            plugins: {
              legend: { labels: { color: '#9ca3af' } }
            }
          }
        });
      },

      renderCategoryPieChart() {
        const ctx = document.getElementById('categoryPieChart');
        if (!ctx) return;

        // Destroy existing chart if it exists
        if (this.categoryPieChart) {
          this.categoryPieChart.destroy();
        }

        const pieData = this.getCategoryPieData();

        this.categoryPieChart = new Chart(ctx, {
          type: 'doughnut',
          data: {
            labels: pieData.labels,
            datasets: [{
              data: pieData.data,
              backgroundColor: pieData.colors,
              borderWidth: 0
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'bottom',
                labels: { color: '#9ca3af' }
              }
            }
          }
        });
      },

      renderIncomeExpenseChart() {
        const ctx = document.getElementById('incomeExpenseChart');
        if (!ctx) return;

        // Destroy existing chart if it exists
        if (this.incomeExpenseChart) {
          this.incomeExpenseChart.destroy();
        }

        const incomeExpenseData = this.getIncomeExpenseData();

        this.incomeExpenseChart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: incomeExpenseData.labels,
            datasets: incomeExpenseData.datasets
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
              y: {
                ticks: {
                  color: '#9ca3af',
                  callback: (value) => '€' + formatAmount(value)
                },
                grid: { color: '#374151' }
              }
            },
            plugins: {
              legend: { labels: { color: '#9ca3af' } }
            }
          }
        });
      },

      renderAccountBalanceChart() {
        const ctx = document.getElementById('accountBalanceChart');
        if (!ctx) return;

        // Destroy existing chart if it exists
        if (this.accountBalanceChart) {
          this.accountBalanceChart.destroy();
        }

        const balanceData = this.getAccountBalanceData();

        this.accountBalanceChart = new Chart(ctx, {
          type: 'line',
          data: {
            labels: balanceData.labels,
            datasets: balanceData.datasets
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: {
                ticks: { color: '#9ca3af' },
                grid: { color: '#374151' }
              },
              y: {
                ticks: {
                  color: '#9ca3af',
                  callback: (value) => '€' + formatAmount(value)
                },
                grid: { color: '#374151' }
              }
            },
            plugins: {
              legend: {
                labels: { color: '#9ca3af' },
                position: 'top'
              }
            },
            interaction: {
              intersect: false,
              mode: 'index'
            }
          }
        });
      },

      getMonthlyExpensesByCategory() {
        const last12Months = [];
        const now = new Date();

        for (let i = 11; i >= 0; i--) {
          const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
          last12Months.push({
            month: date.getMonth(),
            year: date.getFullYear(),
            label: date.toLocaleDateString('nl-NL', { month: 'short', year: '2-digit' })
          });
        }

        const categoryData = {};
        this.categories.forEach(cat => {
          categoryData[cat.name] = new Array(12).fill(0);
        });

        this.transactions.forEach(transaction => {
          if (transaction.amount >= 0) return; // Skip income

          const transactionDate = new Date(transaction.date);
          const monthIndex = last12Months.findIndex(m =>
            m.month === transactionDate.getMonth() && m.year === transactionDate.getFullYear()
          );

          if (monthIndex !== -1) {
            const category = transaction.category;
            if (categoryData[category]) {
              categoryData[category][monthIndex] += Math.abs(transaction.amount);
            }
          }
        });

        const datasets = Object.entries(categoryData)
          .filter(([, amounts]) => amounts.some(amount => amount > 0))
          .map(([categoryName, amounts]) => {
            const category = this.categories.find(c => c.name === categoryName);
            return {
              label: categoryName,
              data: amounts,
              backgroundColor: category ? category.color + '80' : '#6b728080',
              borderColor: category ? category.color : '#6b7280',
              borderWidth: 1
            };
          });

        return {
          labels: last12Months.map(m => m.label),
          datasets
        };
      },

      getMonthlyTrendData() {
        const now = new Date();
        const timeRangeFilter = this.getTimeRangeFilter();

        // Check if we should show daily data (for this_month and last_month)
        const showDailyData = this.selectedTimeRange === 'this_month' || this.selectedTimeRange === 'last_month';

        if (showDailyData) {
          return this.getDailyTrendData();
        }

        // Determine number of months based on time range
        let numMonths;
        switch (this.selectedTimeRange) {
          case 'last_6_months':
            numMonths = 6;
            break;
          case 'last_12_months':
          default:
            numMonths = 12;
            break;
        }

        const months = [];
        for (let i = numMonths - 1; i >= 0; i--) {
          const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
          months.push({
            month: date.getMonth(),
            year: date.getFullYear(),
            label: date.toLocaleDateString('nl-NL', { month: 'short', year: '2-digit' })
          });
        }

        // Filter transactions by account if selected and by time range
        let filteredTransactions = this.selectedAccount
          ? this.transactions.filter(t => t.account === this.selectedAccount)
          : this.transactions;

        // Apply time range filter
        filteredTransactions = filteredTransactions.filter(t => {
          const transactionDate = new Date(t.date);
          return transactionDate >= timeRangeFilter.startDate && transactionDate <= timeRangeFilter.endDate;
        });

        const incomeData = new Array(numMonths).fill(0);
        const expenseData = new Array(numMonths).fill(0);

        filteredTransactions.forEach(transaction => {
          const transactionDate = new Date(transaction.date);
          const monthIndex = months.findIndex(m =>
            m.month === transactionDate.getMonth() && m.year === transactionDate.getFullYear()
          );

          if (monthIndex !== -1) {
            if (transaction.amount >= 0) {
              incomeData[monthIndex] += transaction.amount;
            } else {
              expenseData[monthIndex] += Math.abs(transaction.amount);
            }
          }
        });

        console.log('getMonthlyTrendData result:', { labels: months.map(m => m.label), incomeData, expenseData });

        return {
          labels: months.map(m => m.label),
          datasets: [
            {
              label: 'Inkomsten',
              data: incomeData,
              borderColor: '#10b981',
              backgroundColor: '#10b98120',
              tension: 0.4
            },
            {
              label: 'Uitgaven',
              data: expenseData,
              borderColor: '#ef4444',
              backgroundColor: '#ef444420',
              tension: 0.4
            }
          ]
        };
      },

      getDailyTrendData() {
        const timeRangeFilter = this.getTimeRangeFilter();

        // Calculate number of days in the period
        const startDate = new Date(timeRangeFilter.startDate);
        const endDate = new Date(timeRangeFilter.endDate);
        const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

        const days = [];
        for (let i = 0; i < daysDiff; i++) {
          const date = new Date(startDate);
          date.setDate(startDate.getDate() + i);
          days.push({
            date: date.getDate(),
            month: date.getMonth(),
            year: date.getFullYear(),
            label: date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }),
            fullDate: date.toISOString().split('T')[0]
          });
        }

        // Filter transactions by account if selected
        let filteredTransactions = this.selectedAccount
          ? this.transactions.filter(t => t.account === this.selectedAccount)
          : this.transactions;

        // Apply time range filter
        filteredTransactions = filteredTransactions.filter(t => {
          const transactionDate = new Date(t.date);
          return transactionDate >= timeRangeFilter.startDate && transactionDate <= timeRangeFilter.endDate;
        });

        const incomeData = new Array(daysDiff).fill(0);
        const expenseData = new Array(daysDiff).fill(0);

        filteredTransactions.forEach(transaction => {
          const transactionDate = new Date(transaction.date);
          const dayIndex = Math.floor((transactionDate - startDate) / (1000 * 60 * 60 * 24));

          if (dayIndex >= 0 && dayIndex < daysDiff) {
            if (transaction.amount >= 0) {
              incomeData[dayIndex] += transaction.amount;
            } else {
              expenseData[dayIndex] += Math.abs(transaction.amount);
            }
          }
        });

        console.log('getDailyTrendData result:', {
          labels: days.map(d => d.label),
          incomeData,
          expenseData
        });

        return {
          labels: days.map(d => d.label),
          datasets: [
            {
              label: 'Inkomsten',
              data: incomeData,
              borderColor: '#10b981',
              backgroundColor: '#10b98120',
              tension: 0.1
            },
            {
              label: 'Uitgaven',
              data: expenseData,
              borderColor: '#ef4444',
              backgroundColor: '#ef444420',
              tension: 0.1
            }
          ]
        };
      },

      getCategoryPieData() {
        // Filter transactions by account if selected
        let filteredTransactions = this.selectedAccount
          ? this.transactions.filter(t => t.account === this.selectedAccount)
          : this.transactions;

        // Apply time range filter
        const timeRangeFilter = this.getTimeRangeFilter();
        filteredTransactions = filteredTransactions.filter(t => {
          const transactionDate = new Date(t.date);
          return transactionDate >= timeRangeFilter.startDate && transactionDate <= timeRangeFilter.endDate;
        });

        const categoryTotals = {};

        filteredTransactions.forEach(transaction => {
          if (transaction.amount < 0) {
            const category = transaction.category;
            if (!categoryTotals[category]) {
              categoryTotals[category] = 0;
            }
            categoryTotals[category] += Math.abs(transaction.amount);
          }
        });

        const labels = Object.keys(categoryTotals);
        const data = Object.values(categoryTotals);
        const colors = labels.map(label => {
          const category = this.categories.find(c => c.name === label);
          return category ? category.color : '#6b7280';
        });

        return { labels, data, colors };
      },

      getAccountBalanceData() {
        const now = new Date();
        const timeRangeFilter = this.getTimeRangeFilter();

        // Check if we should show daily data (for this_month and last_month)
        const showDailyData = this.selectedTimeRange === 'this_month' || this.selectedTimeRange === 'last_month';

        if (showDailyData) {
          return this.getDailyAccountBalanceData();
        }

        // Determine number of months based on time range
        let numMonths;
        switch (this.selectedTimeRange) {
          case 'last_6_months':
            numMonths = 6;
            break;
          case 'last_12_months':
          default:
            numMonths = 12;
            break;
        }

        const months = [];
        for (let i = numMonths - 1; i >= 0; i--) {
          const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
          months.push({
            month: date.getMonth(),
            year: date.getFullYear(),
            label: date.toLocaleDateString('nl-NL', { month: 'short', year: '2-digit' })
          });
        }

        // Filter transactions by account if selected, but for balances we show all accounts
        const filteredTransactions = this.selectedAccount
          ? this.transactions.filter(t => t.account === this.selectedAccount)
          : this.transactions;

        // Group transactions by account
        const accountData = {};
        const accounts = [...new Set(filteredTransactions.map(t => t.account).filter(account => account && account.trim()))].sort();

        // Initialize data structure for each account
        accounts.forEach(account => {
          accountData[account] = {};
          months.forEach(month => {
            accountData[account][month.label] = null; // null means no data for that month
          });
        });

        // Fill in balance data for each account and month
        // For each account and each month, find the last transaction in that month
        accounts.forEach(account => {
          months.forEach(month => {
            // Find all transactions for this account in this month
            const monthTransactions = filteredTransactions
              .filter(t =>
                t.account === account &&
                t.balance !== null &&
                t.balance !== undefined &&
                new Date(t.date).getMonth() === month.month &&
                new Date(t.date).getFullYear() === month.year
              )
              .sort((a, b) => new Date(b.date) - new Date(a.date)); // Sort by date descending (newest first)

            // Use the balance from the last transaction in this month
            if (monthTransactions.length > 0) {
              accountData[account][month.label] = monthTransactions[0].balance;
            }
          });
        });

        // Create datasets for Chart.js
        const datasets = accounts.map((account, index) => {
          const colors = [
            '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
            '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6b7280'
          ];

          return {
            label: account,
            data: months.map(month => accountData[account][month.label]),
            borderColor: colors[index % colors.length],
            backgroundColor: colors[index % colors.length] + '20',
            tension: 0.1,
            fill: false,
            spanGaps: true // Connect points even with null values
          };
        });

        return {
          labels: months.map(m => m.label),
          datasets: datasets
        };
      },

      getCategoryStatistics() {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        // Get all categories
        const categories = [...new Set(this.transactions.map(t => t.category))].sort();

        // Filter transactions by account if selected
        let filteredTransactions = this.selectedAccount
          ? this.transactions.filter(t => t.account === this.selectedAccount)
          : this.transactions;

        const statistics = {};

        categories.forEach(category => {
          const categoryTransactions = filteredTransactions.filter(t => t.category === category);

          // Group transactions by month/year
          const monthlyTotals = {};
          categoryTransactions.forEach(transaction => {
            const date = new Date(transaction.date);
            const key = `${date.getFullYear()}-${date.getMonth()}`;
            if (!monthlyTotals[key]) {
              monthlyTotals[key] = 0;
            }
            monthlyTotals[key] += Math.abs(transaction.amount);
          });

          // Calculate statistics
          const thisMonth = monthlyTotals[`${currentYear}-${currentMonth}`] || 0;
          const lastMonth = monthlyTotals[`${currentYear}-${currentMonth - 1}`] ||
                           monthlyTotals[`${currentYear - 1}-${11}`] || 0;

          // Calculate averages
          const last12Months = [];
          for (let i = 0; i < 12; i++) {
            const date = new Date(currentYear, currentMonth - i, 1);
            const key = `${date.getFullYear()}-${date.getMonth()}`;
            last12Months.push(monthlyTotals[key] || 0);
          }

          const last6Months = last12Months.slice(0, 6);
          const previousYear = [];
          for (let i = 12; i < 24; i++) {
            const date = new Date(currentYear, currentMonth - i, 1);
            const key = `${date.getFullYear()}-${date.getMonth()}`;
            previousYear.push(monthlyTotals[key] || 0);
          }

          const avgLast12Months = last12Months.reduce((sum, val) => sum + val, 0) / 12;
          const avgLast6Months = last6Months.reduce((sum, val) => sum + val, 0) / 6;
          const avgPreviousYear = previousYear.reduce((sum, val) => sum + val, 0) / 12;

          // Find highest and lowest months
          const allMonths = Object.values(monthlyTotals);
          const highestMonth = allMonths.length > 0 ? Math.max(...allMonths) : 0;
          const lowestMonth = allMonths.length > 0 ? Math.min(...allMonths) : 0;

          statistics[category] = {
            thisMonth,
            lastMonth,
            avgLast12Months,
            avgLast6Months,
            avgPreviousYear,
            highestMonth,
            lowestMonth,
            // Helper for color logic: true if this month is higher than last month (worse)
            isThisMonthHigher: thisMonth > lastMonth
          };
        });

        return statistics;
      },

      getDailyAccountBalanceData() {
        const timeRangeFilter = this.getTimeRangeFilter();

        // Calculate number of days in the period
        const startDate = new Date(timeRangeFilter.startDate);
        const endDate = new Date(timeRangeFilter.endDate);
        const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

        const days = [];
        for (let i = 0; i < daysDiff; i++) {
          const date = new Date(startDate);
          date.setDate(startDate.getDate() + i);
          days.push({
            date: date.getDate(),
            month: date.getMonth(),
            year: date.getFullYear(),
            label: date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }),
            fullDate: date.toISOString().split('T')[0]
          });
        }

        // Filter transactions by account if selected, but for balances we show all accounts
        let filteredTransactions = this.selectedAccount
          ? this.transactions.filter(t => t.account === this.selectedAccount)
          : this.transactions;

        // Apply time range filter
        filteredTransactions = filteredTransactions.filter(t => {
          const transactionDate = new Date(t.date);
          return transactionDate >= timeRangeFilter.startDate && transactionDate <= timeRangeFilter.endDate;
        });

        // Group transactions by account
        const accountData = {};
        const accounts = [...new Set(filteredTransactions.map(t => t.account).filter(account => account && account.trim()))].sort();

        // Initialize data structure for each account
        accounts.forEach(account => {
          accountData[account] = {};
          days.forEach(day => {
            accountData[account][day.fullDate] = null; // null means no data for that day
          });
        });

        // Fill in balance data for each account and day
        // Sort transactions by date to get the balance progression
        const sortedTransactions = filteredTransactions
          .filter(t => t.balance !== null && t.balance !== undefined)
          .sort((a, b) => new Date(a.date) - new Date(b.date));

        sortedTransactions.forEach(transaction => {
          if (transaction.account && accounts.includes(transaction.account)) {
            const transactionDate = new Date(transaction.date).toISOString().split('T')[0];
            // Store the balance for this day (will be overwritten by later transactions on the same day)
            if (accountData[transaction.account][transactionDate] !== undefined) {
              accountData[transaction.account][transactionDate] = transaction.balance;
            }
          }
        });

        // Create datasets for Chart.js
        const colors = [
          '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
          '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6b7280'
        ];

        const datasets = accounts.map((account, index) => ({
          label: account,
          data: days.map(day => accountData[account][day.fullDate]),
          borderColor: colors[index % colors.length],
          backgroundColor: colors[index % colors.length] + '20',
          tension: 0.1,
          fill: false,
          spanGaps: true // Connect points even with null values
        }));

        return {
          labels: days.map(d => d.label),
          datasets: datasets
        };
      },

      getIncomeExpenseData() {
        const now = new Date();

        // Determine number of months based on time range
        let numMonths;
        switch (this.selectedTimeRange) {
          case 'this_month':
            // For this month, show this month + 5 previous months for context
            numMonths = 6;
            break;
          case 'last_month':
            // For last month, show last month + 5 previous months for context
            numMonths = 6;
            break;
          case 'last_6_months':
            numMonths = 6;
            break;
          case 'last_12_months':
          default:
            numMonths = 12;
            break;
        }

        const months = [];
        let startMonthOffset = 0;

        // Adjust start month based on selected time range
        if (this.selectedTimeRange === 'last_month') {
          startMonthOffset = 1; // Start from last month
        }

        for (let i = numMonths - 1; i >= 0; i--) {
          const date = new Date(now.getFullYear(), now.getMonth() - i - startMonthOffset, 1);
          months.push({
            month: date.getMonth(),
            year: date.getFullYear(),
            label: date.toLocaleDateString('nl-NL', { month: 'short', year: '2-digit' })
          });
        }

        // Filter transactions by account if selected
        let filteredTransactions = this.selectedAccount
          ? this.transactions.filter(t => t.account === this.selectedAccount)
          : this.transactions;

        // For the income/expense chart, we don't apply additional time filtering
        // as we want to show the full period selected by the user

        const incomeData = new Array(numMonths).fill(0);
        const expenseData = new Array(numMonths).fill(0);

        // Filter transactions to only include those within our calculated months
        const relevantMonths = months.map(m => ({ year: m.year, month: m.month }));

        filteredTransactions.forEach(transaction => {
          const transactionDate = new Date(transaction.date);
          const transactionMonth = transactionDate.getMonth();
          const transactionYear = transactionDate.getFullYear();

          const monthIndex = relevantMonths.findIndex(m =>
            m.month === transactionMonth && m.year === transactionYear
          );

          if (monthIndex !== -1) {
            if (transaction.amount >= 0) {
              incomeData[monthIndex] += transaction.amount;
            } else {
              expenseData[monthIndex] += Math.abs(transaction.amount);
            }
          }
        });

        console.log('getIncomeExpenseData result:', { labels: months.map(m => m.label), incomeData, expenseData });

        return {
          labels: months.map(m => m.label),
          datasets: [
            {
              label: 'Inkomsten',
              data: incomeData,
              backgroundColor: '#10b98180',
              borderColor: '#10b981',
              borderWidth: 1
            },
            {
              label: 'Uitgaven',
              data: expenseData,
              backgroundColor: '#ef444480',
              borderColor: '#ef4444',
              borderWidth: 1
            }
          ]
        };
      },

      // ============================================================================
      // TRANSACTION MANAGEMENT
      // ============================================================================

      openAddTransactionModal() {
        this.editingTransaction = null;
        this.transactionForm = {
          date: new Date().toISOString().split('T')[0],
          name: '',
          description: '',
          amount: '',
          account: '',
          category: this.categories.length > 0 ? this.categories[0].name : ''
        };
        this.showTransactionModal = true;
      },

      editTransaction(transaction) {
        this.editingTransaction = transaction;
        this.transactionForm = {
          date: transaction.date,
          name: transaction.name || '',
          description: transaction.description,
          amount: transaction.amount.toString(),
          account: transaction.account || '',
          category: transaction.category
        };
        this.showTransactionModal = true;
      },

      closeTransactionModal() {
        this.showTransactionModal = false;
        this.editingTransaction = null;
        this.transactionForm = {
          date: '',
          name: '',
          description: '',
          amount: '',
          account: '',
          category: ''
        };
      },

      async saveTransaction() {
        try {
          // Validate form
          if (!this.transactionForm.description.trim()) {
            showToast('Voer een omschrijving in', 'error');
            return;
          }

          if (!this.transactionForm.amount || isNaN(parseFloat(this.transactionForm.amount))) {
            showToast('Voer een geldig bedrag in', 'error');
            return;
          }

          if (!this.transactionForm.category) {
            showToast('Selecteer een categorie', 'error');
            return;
          }

          const transactionData = {
            date: this.transactionForm.date,
            name: this.transactionForm.name.trim(),
            description: this.transactionForm.description.trim(),
            amount: parseFloat(this.transactionForm.amount),
            account: this.transactionForm.account.trim(),
            category: this.transactionForm.category
          };

          // Apply rules before saving
          const processedData = await this.applyRulesToTransaction(transactionData);

          if (this.editingTransaction) {
            // Update existing transaction
            await manager.saveSmartDocument('transactions', {
              ...this.editingTransaction,
              ...processedData
            });
            showToast('Transactie bijgewerkt', 'success');
          } else {
            // Create new transaction
            await manager.saveSmartDocument('transactions', processedData);
            showToast('Transactie toegevoegd', 'success');
          }

          this.closeTransactionModal();
          await this.refreshData();
        } catch (error) {
          console.error('Error saving transaction:', error);
          showToast('Fout bij opslaan transactie', 'error');
        }
      },

      async deleteTransaction(transactionId) {
        if (!confirm('Weet je zeker dat je deze transactie wilt verwijderen?')) {
          return;
        }

        try {
          await manager.deleteSmartDocument('transactions', transactionId);
          showToast('Transactie verwijderd', 'success');
          await this.refreshData();
        } catch (error) {
          console.error('Error deleting transaction:', error);
          showToast('Fout bij verwijderen transactie', 'error');
        }
      },

      // ============================================================================
      // CATEGORY MANAGEMENT
      // ============================================================================

      openAddCategoryModal() {
        this.editingCategory = null;
        this.categoryForm = {
          name: '',
          color: '#6366f1'
        };
        this.showCategoryModal = true;
      },

      editCategory(category) {
        this.editingCategory = category;
        this.categoryForm = {
          name: category.name,
          color: category.color
        };
        this.showCategoryModal = true;
      },

      closeCategoryModal() {
        this.showCategoryModal = false;
        this.editingCategory = null;
        this.categoryForm = {
          name: '',
          color: '#6366f1'
        };
      },

      async saveCategory() {
        try {
          // Validate form
          if (!this.categoryForm.name.trim()) {
            showToast('Voer een categorienaam in', 'error');
            return;
          }

          const categoryData = {
            name: this.categoryForm.name.trim(),
            color: this.categoryForm.color
          };

          // Check for duplicate names
          const existingCategory = this.categories.find(c =>
            c.name.toLowerCase() === categoryData.name.toLowerCase() &&
            (!this.editingCategory || c.id !== this.editingCategory.id)
          );

          if (existingCategory) {
            showToast('Een categorie met deze naam bestaat al', 'error');
            return;
          }

          if (this.editingCategory) {
            // Update existing category
            await manager.saveSmartDocument('categories', {
              ...this.editingCategory,
              ...categoryData
            });
            showToast('Categorie bijgewerkt', 'success');
          } else {
            // Create new category
            await manager.saveSmartDocument('categories', categoryData);
            showToast('Categorie toegevoegd', 'success');
          }

          this.closeCategoryModal();
          await this.refreshData();
        } catch (error) {
          console.error('Error saving category:', error);
          showToast('Fout bij opslaan categorie', 'error');
        }
      },

      async deleteCategory(categoryId) {
        const category = this.categories.find(c => c.id === categoryId);
        if (!category) return;

        // Check if category is in use
        const transactionsUsingCategory = this.transactions.filter(t => t.category === category.name);

        let confirmMessage = `Weet je zeker dat je de categorie "${category.name}" wilt verwijderen?`;
        if (transactionsUsingCategory.length > 0) {
          confirmMessage += `\n${transactionsUsingCategory.length} transacties zullen worden verplaatst naar "Not defined".`;
        }

        if (!confirm(confirmMessage)) {
          return;
        }

        try {
          // Move transactions to "Not defined" category
          if (transactionsUsingCategory.length > 0) {
            // Ensure "Not defined" category exists
            let notDefinedCategory = this.categories.find(c => c.name === 'Not defined');
            if (!notDefinedCategory) {
              await manager.saveSmartDocument('categories', {
                name: 'Not defined',
                color: '#6b7280'
              });
              this.categories = await manager.getSmartCollection('categories') || [];
              notDefinedCategory = this.categories.find(c => c.name === 'Not defined');
            }

            // Update all transactions to use "Not defined"
            for (const transaction of transactionsUsingCategory) {
              await manager.saveSmartDocument('transactions', {
                ...transaction,
                category: 'Not defined'
              });
            }
          }

          // Delete the category
          await manager.deleteSmartDocument('categories', categoryId);
          showToast(`Categorie verwijderd${transactionsUsingCategory.length > 0 ? `, ${transactionsUsingCategory.length} transacties verplaatst naar "Not defined"` : ''}`, 'success');
          await this.refreshData();
        } catch (error) {
          console.error('Error deleting category:', error);
          showToast('Fout bij verwijderen categorie', 'error');
        }
      },

      getCategoryColor(categoryName) {
        const category = this.categories.find(c => c.name === categoryName);
        return category ? category.color : '#6b7280';
      },

      // ============================================================================
      // BULK EDIT FUNCTIONALITY
      // ============================================================================

      openBulkEditModal() {
        if (this.selectedTransactions.length === 0) {
          showToast('Selecteer eerst transacties', 'error');
          return;
        }

        this.bulkEditForm = {
          category: '',
          name: '',
          description: '',
          account: ''
        };
        this.showBulkEditModal = true;
      },

      closeBulkEditModal() {
        this.showBulkEditModal = false;
        this.bulkEditForm = {
          category: '',
          name: '',
          description: '',
          account: ''
        };
      },

      async applyBulkEdit() {
        console.log('Bulk edit selected transactions:', this.selectedTransactions);
        console.log('Bulk edit form:', this.bulkEditForm);

        if (this.selectedTransactions.length === 0) {
          showToast('Geen transacties geselecteerd', 'error');
          return;
        }

        const updates = {};
        if (this.bulkEditForm.category) updates.category = this.bulkEditForm.category;
        if (this.bulkEditForm.name.trim()) updates.name = this.bulkEditForm.name.trim();
        if (this.bulkEditForm.description.trim()) updates.description = this.bulkEditForm.description.trim();
        if (this.bulkEditForm.account.trim()) updates.account = this.bulkEditForm.account.trim();

        console.log('Updates object:', updates);

        if (Object.keys(updates).length === 0) {
          showToast('Geen wijzigingen opgegeven', 'error');
          return;
        }

        try {
          let updatedCount = 0;

          for (const transactionId of this.selectedTransactions) {
            console.log('Processing transaction ID:', transactionId);
            const transaction = this.transactions.find(t => t.id === transactionId);
            console.log('Found transaction:', transaction);
            if (transaction) {
              await manager.saveSmartDocument('transactions', {
                ...transaction,
                ...updates
              });
              updatedCount++;
            } else {
              console.log('Transaction not found for ID:', transactionId);
            }
          }

          showToast(`${updatedCount} transacties bijgewerkt`, 'success');
          this.closeBulkEditModal();
          this.selectedTransactions = [];
          await this.refreshData();
        } catch (error) {
          console.error('Error applying bulk edit:', error);
          showToast('Fout bij bulk bewerken', 'error');
        }
      },

      async deleteSelectedTransactions() {
        if (this.selectedTransactions.length === 0) {
          showToast('Geen transacties geselecteerd', 'error');
          return;
        }

        if (!confirm(`Weet je zeker dat je ${this.selectedTransactions.length} transacties wilt verwijderen?`)) {
          return;
        }

        try {
          let deletedCount = 0;

          for (const transactionId of this.selectedTransactions) {
            await manager.deleteSmartDocument('transactions', transactionId);
            deletedCount++;
          }

          showToast(`${deletedCount} transacties verwijderd`, 'success');
          this.selectedTransactions = [];
          await this.refreshData();
        } catch (error) {
          console.error('Error deleting selected transactions:', error);
          showToast('Fout bij verwijderen transacties', 'error');
        }
      },

      // ============================================================================
      // RULES ENGINE
      // ============================================================================

      openAddRuleModal() {
        this.editingRule = null;
        this.ruleForm = {
          name: '',
          condition: {
            field: 'description',
            operator: 'contains',
            value: ''
          },
          action: {
            type: 'set_category',
            value: ''
          }
        };
        this.showRuleModal = true;
      },

      editRule(rule) {
        this.editingRule = rule;
        this.ruleForm = {
          name: rule.name,
          condition: { ...rule.condition },
          action: { ...rule.action }
        };
        this.showRuleModal = true;
      },

      closeRuleModal() {
        this.showRuleModal = false;
        this.editingRule = null;
        this.ruleForm = {
          name: '',
          condition: {
            field: 'description',
            operator: 'contains',
            value: ''
          },
          action: {
            type: 'set_category',
            value: ''
          }
        };
      },

      async saveRule() {
        try {
          // Validate form
          if (!this.ruleForm.name.trim()) {
            showToast('Voer een regelnaam in', 'error');
            return;
          }

          if (!this.ruleForm.condition.value.trim()) {
            showToast('Voer een voorwaarde waarde in', 'error');
            return;
          }

          if (!this.ruleForm.action.value.trim()) {
            showToast('Voer een actie waarde in', 'error');
            return;
          }

          const ruleData = {
            name: this.ruleForm.name.trim(),
            condition: { ...this.ruleForm.condition },
            action: { ...this.ruleForm.action },
            active: true,
            appliedCount: 0
          };

          if (this.editingRule) {
            // Update existing rule
            await manager.saveSmartDocument('rules', {
              ...this.editingRule,
              ...ruleData
            });
            showToast('Regel bijgewerkt', 'success');
          } else {
            // Create new rule
            await manager.saveSmartDocument('rules', ruleData);
            showToast('Regel toegevoegd', 'success');
          }

          this.closeRuleModal();
          await this.refreshData();
        } catch (error) {
          console.error('Error saving rule:', error);
          showToast('Fout bij opslaan regel', 'error');
        }
      },

      async deleteRule(ruleId) {
        if (!confirm('Weet je zeker dat je deze regel wilt verwijderen?')) {
          return;
        }

        try {
          await manager.deleteSmartDocument('rules', ruleId);
          showToast('Regel verwijderd', 'success');
          await this.refreshData();
        } catch (error) {
          console.error('Error deleting rule:', error);
          showToast('Fout bij verwijderen regel', 'error');
        }
      },

      async toggleRuleActive(rule) {
        try {
          await manager.saveSmartDocument('rules', {
            ...rule,
            active: !rule.active
          });
          showToast(`Regel ${rule.active ? 'uitgeschakeld' : 'ingeschakeld'}`, 'success');
          await this.refreshData();
        } catch (error) {
          console.error('Error toggling rule:', error);
          showToast('Fout bij wijzigen regel status', 'error');
        }
      },

      async applyRulesToTransaction(transaction) {
        let processedTransaction = { ...transaction };

        for (const rule of this.rules) {
          if (!rule.active) continue;

          const matchesCondition = this.checkRuleCondition(processedTransaction, rule.condition);
          if (matchesCondition) {
            processedTransaction = this.applyRuleAction(processedTransaction, rule.action);

            // Update rule applied count
            await manager.saveSmartDocument('rules', {
              ...rule,
              appliedCount: (rule.appliedCount || 0) + 1
            });
          }
        }

        return processedTransaction;
      },

      async applyRulesToTransactions() {
        // This would be called when importing or bulk operations
        // For now, we apply rules to all transactions (could be optimized)
        const updatedTransactions = [];

        for (const transaction of this.transactions) {
          const processed = await this.applyRulesToTransaction(transaction);
          if (JSON.stringify(processed) !== JSON.stringify(transaction)) {
            updatedTransactions.push(processed);
          }
        }

        // Save updated transactions
        for (const transaction of updatedTransactions) {
          await manager.saveSmartDocument('transactions', transaction);
        }

        if (updatedTransactions.length > 0) {
          console.log(`[FinancePro] Applied rules to ${updatedTransactions.length} transactions`);
        }
      },

      checkRuleCondition(transaction, condition) {
        const fieldValue = transaction[condition.field];
        const conditionValue = condition.value.toLowerCase();
        const fieldValueLower = fieldValue.toLowerCase();

        switch (condition.operator) {
          case 'contains':
            return fieldValueLower.includes(conditionValue);
          case 'equals':
            return fieldValueLower === conditionValue;
          case 'starts_with':
            return fieldValueLower.startsWith(conditionValue);
          case 'greater_than':
            return parseFloat(fieldValue) > parseFloat(condition.value);
          case 'less_than':
            return parseFloat(fieldValue) < parseFloat(condition.value);
          default:
            return false;
        }
      },

      applyRuleAction(transaction, action) {
        const updatedTransaction = { ...transaction };

        switch (action.type) {
          case 'set_category':
            updatedTransaction.category = action.value;
            break;
          case 'set_description':
            updatedTransaction.description = action.value;
            break;
        }

        return updatedTransaction;
      },

      // ============================================================================
      // CSV IMPORT
      // ============================================================================

      openCsvImportModal() {
        this.csvPreview = [];
        this.selectedCsvFile = null;
        this.csvColumns = [];
        this.csvMapping = {
          date: '',
          name: '',
          description: '',
          amount: '',
          balance: '',
          account: '',
          category: '',
          delimiter: ','
        };
        this.showCsvImportModal = true;

        // Load demo data for preview
        setTimeout(() => {
          this.loadDemoCsvData();
        }, 100);
      },

      loadDemoCsvData() {
        // Demo CSV data voor preview met header
        const demoCsv = `Datum,Omschrijving,Van/Naar,Bedrag
2024-01-15,Salaris,Werkgever,2500.00
2024-01-16,Boodschappen,Albert Heijn,-85.50
2024-01-17,Tankstation,Shell,-65.00
2024-01-18,Netflix abonnement,,-15.99
2024-01-20,Restaurant,De Gouden Leeuw,-45.80`;

        this.parseCsvPreviewFromText(demoCsv);
      },

      async       parseCsvPreviewFromText(csvText) {
        try {
          const lines = csvText.split('\n').filter(line => line.trim());
          const delimiter = this.csvMapping.delimiter;

          // Extract column names from header (first line)
          if (lines.length > 0) {
            const headerColumns = lines[0].split(delimiter);
            this.csvColumns = headerColumns.map(col => col.replace(/"/g, '').trim());
          }

          // Show preview of first 5 data rows (skip header)
          this.csvPreview = lines.slice(1, 6).map(line => {
            const columns = line.split(delimiter);
            return columns.map(col => col.replace(/"/g, '').trim()).join(' | ');
          });

          // Auto-detect columns if possible
          this.autoDetectColumns();
        } catch (error) {
          console.error('Error parsing CSV text:', error);
        }
      },

      autoDetectColumns() {
        if (!this.csvColumns || this.csvColumns.length === 0) return;

        const mappings = {
          date: ['datum', 'date', 'dt', 'time'],
          name: ['naam', 'name', 'receiver', 'sender', 'persoon'],
          description: ['omschrijving', 'description', 'desc', 'details', 'memo'],
          amount: ['bedrag', 'amount', 'amt', 'waarde', 'value', 'sum'],
          balance: ['saldo', 'balance', 'bal', 'saldo na', 'balance after'],
          account: ['van/naar', 'van', 'naar', 'account', 'rekening', 'from/to', 'from', 'to'],
          category: ['categorie', 'category', 'cat', 'type', 'soort']
        };

        // Reset mappings
        Object.keys(this.csvMapping).forEach(key => {
          if (key !== 'delimiter') this.csvMapping[key] = '';
        });

        // Try to match columns
        this.csvColumns.forEach((columnName, index) => {
          const lowerColumn = columnName.toLowerCase();
          for (const [field, keywords] of Object.entries(mappings)) {
            if (keywords.some(keyword => lowerColumn.includes(keyword))) {
              if (!this.csvMapping[field]) { // Only set if not already set
                this.csvMapping[field] = index.toString();
              }
              break;
            }
          }
        });

        console.log('Auto-detected mappings:', this.csvMapping);
      },

      handleCsvFileSelect(event) {
        const file = event.target.files[0];
        if (file) {
          this.selectedCsvFile = file;
          this.parseCsvPreviewFromFile(file);
        }
      },

      clearCsvFile() {
        this.selectedCsvFile = null;
        this.csvPreview = [];
        this.csvColumns = [];
        if (this.$refs.csvFileInput) {
          this.$refs.csvFileInput.value = '';
        }
        // Herlaad demo data
        this.loadDemoCsvData();
      },

      async parseCsvPreviewFromFile(file) {
        try {
          const text = await file.text();
          const lines = text.split('\n').filter(line => line.trim());
          const delimiter = this.csvMapping.delimiter;

          // Extract column names from header (first line)
          if (lines.length > 0) {
            const headerColumns = lines[0].split(delimiter);
            this.csvColumns = headerColumns.map(col => col.replace(/"/g, '').trim());
          }

          // Show preview of first 5 data rows (skip header)
          this.csvPreview = lines.slice(1, 6).map(line => {
            const columns = line.split(delimiter);
            return columns.map(col => col.replace(/"/g, '').trim()).join(' | ');
          });
        } catch (error) {
          console.error('Error parsing CSV file:', error);
          showToast('Fout bij het lezen van CSV bestand', 'error');
        }
      },

      closeCsvImportModal() {
        this.showCsvImportModal = false;
        this.csvPreview = [];
        this.selectedCsvFile = null;
        this.csvColumns = [];
      },


      async processCsvImport() {
        if (!this.selectedCsvFile) {
          showToast('Selecteer eerst een CSV bestand', 'error');
          return;
        }

        // Check if required columns are mapped
        if (this.csvMapping.date === '' || this.csvMapping.amount === '') {
          showToast('Selecteer minimaal de vereiste kolommen (Datum, Bedrag)', 'error');
          return;
        }

        // Ensure "Not defined" category exists
        const notDefinedCategory = this.categories.find(c => c.name === 'Not defined');
        if (!notDefinedCategory) {
          try {
            await manager.saveSmartDocument('categories', {
              name: 'Not defined',
              color: '#6b7280'
            });
            // Refresh categories list
            this.categories = await manager.getSmartCollection('categories') || [];
          } catch (error) {
            console.warn('[FinancePro] Could not create "Not defined" category:', error);
          }
        }

        try {
          const csvText = await this.selectedCsvFile.text();
          const parseResult = await this.parseCsvData(csvText);
          const importedTransactions = parseResult.transactions;
          const csvDuplicateCount = parseResult.duplicateCount;

          if (importedTransactions.length === 0 && csvDuplicateCount === 0) {
            showToast('Geen geldige transacties gevonden. Controleer de kolom mapping.', 'error');
            return;
          }

          if (importedTransactions.length === 0 && csvDuplicateCount > 0) {
            showToast(`Alle ${csvDuplicateCount} transacties waren al aanwezig (duplicates overgeslagen)`, 'info');
            this.closeCsvImportModal();
            return;
          }

          let importedCount = 0;
          let duplicateCount = 0;

          for (const transaction of importedTransactions) {
            try {
              // Apply rules before saving
              const processedTransaction = await this.applyRulesToTransaction(transaction);
              await manager.saveSmartDocument('transactions', processedTransaction);
              importedCount++;
            } catch (error) {
              console.warn('Failed to import transaction:', transaction, error);
            }
          }

          if (csvDuplicateCount > 0) {
            showToast(`${importedCount} transacties geïmporteerd, ${csvDuplicateCount} duplicates overgeslagen`, 'success');
          } else {
            showToast(`${importedCount} transacties geïmporteerd`, 'success');
          }
          this.closeCsvImportModal();
          await this.refreshData();
        } catch (error) {
          console.error('Error processing CSV:', error);
          showToast('Fout bij verwerken CSV bestand', 'error');
        }
      },

      async parseCsvData(csvText) {
        const lines = csvText.split('\n').filter(line => line.trim());
        const delimiter = this.csvMapping.delimiter;
        const dateIndex = this.csvMapping.date !== '' ? parseInt(this.csvMapping.date) : -1;
        const nameIndex = this.csvMapping.name !== '' ? parseInt(this.csvMapping.name) : -1;
        const descriptionIndex = this.csvMapping.description !== '' ? parseInt(this.csvMapping.description) : -1;
        const amountIndex = this.csvMapping.amount !== '' ? parseInt(this.csvMapping.amount) : -1;
        const balanceIndex = this.csvMapping.balance !== '' ? parseInt(this.csvMapping.balance) : -1;
        const accountIndex = this.csvMapping.account !== '' ? parseInt(this.csvMapping.account) : -1;
        const categoryIndex = this.csvMapping.category !== '' ? parseInt(this.csvMapping.category) : -1;

        const transactions = [];
        let duplicateCount = 0;

        for (let i = 1; i < lines.length; i++) { // Skip header
          const columns = lines[i].split(delimiter).map(col => col.replace(/"/g, '').trim());

          // Check if required columns are mapped
          if (dateIndex === -1 || descriptionIndex === -1 || amountIndex === -1) {
            continue; // Skip if required columns not mapped
          }

          // Calculate max index for validation
          const indices = [dateIndex, nameIndex, descriptionIndex, amountIndex, balanceIndex, accountIndex, categoryIndex].filter(i => i !== -1);
          const maxIndex = indices.length > 0 ? Math.max(...indices) : 0;

          if (columns.length <= maxIndex) {
            continue; // Skip malformed lines
          }

          const dateStr = columns[dateIndex];
          const nameStr = nameIndex !== -1 ? columns[nameIndex] : '';
          const description = descriptionIndex !== -1 ? columns[descriptionIndex] : '';
          const amountStr = columns[amountIndex].replace(',', '.');
          const balanceStr = balanceIndex !== -1 ? columns[balanceIndex] : '';
          const accountStr = accountIndex !== -1 ? columns[accountIndex] : '';
          const categoryStr = categoryIndex !== -1 ? columns[categoryIndex] : '';

          // Parse date - Verbeterde versie voor juiste dag-maand-jaar parsing
          let date;
          try {
            if (dateStr.includes('-') || dateStr.includes('/')) {
              const separator = dateStr.includes('-') ? '-' : '/';
              const parts = dateStr.split(separator);
              // Forceer formaat: Dag [0], Maand [1], Jaar [2]
              if (parts.length === 3) {
                const day = parts[0].padStart(2, '0');
                const month = parts[1].padStart(2, '0');
                const year = parts[2].length === 2 ? '20' + parts[2] : parts[2];
                date = `${year}-${month}-${day}`;
              }
            } else {
              date = new Date(dateStr).toISOString().split('T')[0];
            }
          } catch (error) {
            console.warn('Could not parse date:', dateStr);
            continue;
          }

          // Parse amount
          let amount;
          try {
            amount = parseFloat(amountStr);
            if (isNaN(amount)) continue;
          } catch (error) {
            console.warn('Could not parse amount:', amountStr);
            continue;
          }

          // Build description from available fields
          let finalDescription = '';
          if (nameStr) finalDescription += nameStr;
          if (description) finalDescription += (finalDescription ? ' - ' : '') + description;
          if (!finalDescription) finalDescription = "Geen omschrijving";

          // Map category to existing categories or use "Not defined"
          let finalCategory = 'Not defined';
          if (categoryStr) {
            // Try to find existing category (case insensitive)
            const existingCategory = this.categories.find(c =>
              c.name.toLowerCase() === categoryStr.toLowerCase().trim()
            );
            if (existingCategory) {
              finalCategory = existingCategory.name;
            } else {
              // Create new category
              const newCategory = {
                name: categoryStr.trim(),
                color: '#6b7280' // Default gray color
              };
              try {
                await manager.saveSmartDocument('categories', newCategory);
                this.categories.push(newCategory);
                finalCategory = newCategory.name;
              } catch (error) {
                console.warn('[FinancePro] Could not create category:', categoryStr, error);
              }
            }
          }

          if (date && !isNaN(amount)) {
            const newTransaction = {
              date,
              name: nameStr || '',
              description: finalDescription,
              amount,
              balance: balanceStr ? parseFloat(balanceStr.replace(',', '.')) : null,
              category: finalCategory,
              account: accountStr || ''
            };

            // Check for duplicates
            if (!this.isDuplicateTransaction(newTransaction)) {
              transactions.push(newTransaction);
            } else {
              console.log('Skipping duplicate transaction:', newTransaction);
              duplicateCount++;
            }
          }
        }

        return { transactions, duplicateCount };
      },

      // Check if a transaction is a duplicate of an existing one
      isDuplicateTransaction(newTransaction) {
        return this.transactions.some(existingTransaction => {
          // Compare key fields for duplication
          return existingTransaction.date === newTransaction.date &&
                 existingTransaction.amount === newTransaction.amount &&
                 existingTransaction.description === newTransaction.description &&
                 existingTransaction.account === newTransaction.account;
        });
      },

      // ============================================================================
      // UTILITY METHODS
      // ============================================================================

      formatAmount(amount) {
        return new Intl.NumberFormat('nl-NL', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }).format(amount);
      },

      formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('nl-NL', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });
      },

      noop() {
        // No operation - used for drag/drop handlers
      },

      getDisplayUrl(transaction) {
        return this.formatAmount(Math.abs(transaction.amount));
      }
    },

    mounted() {
      // Load saved theme
      const savedTheme = localStorage.getItem('financepro_theme') || 'indigo';
      this.settings.themeColor = savedTheme;
      document.documentElement.setAttribute('data-theme', savedTheme);

      // Auto-login for demo (in production, this would be proper authentication)
      if (!this.isAuthenticated) {
        this.loginForm.username = 'demo_user';
        this.login();
      }

      // Click outside handler for account filter dropdown
      document.addEventListener('click', (event) => {
        const accountFilterButton = event.target.closest('[data-account-filter]');
        const accountFilterDropdown = event.target.closest('[data-account-dropdown]');
        const timeFilterButton = event.target.closest('[data-time-filter]');
        const timeFilterDropdown = event.target.closest('[data-time-dropdown]');

        if (!accountFilterButton && !accountFilterDropdown) {
          this.showAccountFilter = false;
        }

        if (!timeFilterButton && !timeFilterDropdown) {
          this.showTimeRangeFilter = false;
        }
      });
    }
  });

  // Mount the app
  window.app = app.mount('#app');
});

