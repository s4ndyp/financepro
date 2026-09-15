/**
 * FinancePro - Finance Management Application
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

/**
 * Parse one CSV line (supports quoted fields with commas and apostrophes).
 * SNS/ING exports often wrap Omschrijving in single quotes, e.g. McDonald's.
 */
function parseCsvRow(line, delimiter = ',') {
  const fields = [];
  let field = '';
  let i = 0;
  let inSingleQuotes = false;

  while (i < line.length) {
    const char = line[i];

    if (inSingleQuotes) {
      if (char === "'") {
        const next = line[i + 1];
        if (next === delimiter || next === undefined) {
          inSingleQuotes = false;
          i += 1;
          continue;
        }
        field += char;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === "'") {
      inSingleQuotes = true;
      i += 1;
      continue;
    }

    if (char === '"') {
      i += 1;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        if (line[i] === '"') {
          i += 1;
          break;
        }
        field += line[i];
        i += 1;
      }
      continue;
    }

    if (char === delimiter) {
      fields.push(field.trim());
      field = '';
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  fields.push(field.trim());
  return fields.map((value) => value.replace(/^['"]|['"]$/g, '').trim());
}

function parseCsvAmount(rawValue) {
  if (rawValue === undefined || rawValue === null) return NaN;
  let value = String(rawValue).trim();
  if (!value) return NaN;
  value = value.replace(/\s/g, '').replace(/[€$£]/g, '');
  if (value.includes(',') && !value.includes('.')) {
    value = value.replace(',', '.');
  } else if (value.includes(',') && value.includes('.')) {
    value = value.replace(/\./g, '').replace(',', '.');
  }
  return parseFloat(value);
}

function parseCsvDate(dateStr) {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  if (trimmed.includes('-') || trimmed.includes('/')) {
    const separator = trimmed.includes('-') ? '-' : '/';
    const parts = trimmed.split(separator);
    if (parts.length === 3) {
      const day = parts[0].padStart(2, '0');
      const month = parts[1].padStart(2, '0');
      const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
      return `${year}-${month}-${day}`;
    }
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split('T')[0];
}

// ============================================================================
// CONFIGURATION & INITIALIZATION
// ============================================================================

const CLIENT_ID = 'sandman'; // In productie zou dit dynamisch zijn
const API_URL = ''; // Zelfde origin; PocketBase serveert static + /api
const TRANSACTIONS_DEFAULT_LIMIT = 500;
const TRANSACTIONS_TABLE_PAGE_SIZE = 100;

let db = null;
let app = null;

// Make app globally accessible for utility functions
window.app = null;

// Theme configuration is now in Vue data

// ============================================================================
// POCKETBASE CLIENT
// ============================================================================

function initializeDatabase() {
  db = new PocketBaseClient(API_URL, CLIENT_ID);
  return true;
}

// ============================================================================
// VUE APPLICATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  if (!initializeDatabase()) {
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
        applyingRuleId: null,
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

        totalTransactionCount: 0,
        transactionsLoadMode: 'recent',
        isLoadingTransactions: false,
        transactionTablePage: 1,
        transactionFilterDebounce: null,

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
        /** Volledige transacties voor vaste kolommen in Categorie Statistieken (niet gekoppeld aan periodefilter) */
        insightsStatsTransactions: [],

        // Category budgets (stored in local storage)
        categoryBudgets: {},

        // Category charts instances
        categoryChartsInstances: [],

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

      paginatedFilteredTransactions() {
        const start = (this.transactionTablePage - 1) * TRANSACTIONS_TABLE_PAGE_SIZE;
        return this.filteredTransactions.slice(start, start + TRANSACTIONS_TABLE_PAGE_SIZE);
      },

      transactionTablePageCount() {
        return Math.max(1, Math.ceil(this.filteredTransactions.length / TRANSACTIONS_TABLE_PAGE_SIZE));
      },

      transactionsLoadHint() {
        if (this.totalTransactionCount <= this.transactions.length) return '';
        if (this.transactionsLoadMode === 'recent') {
          return `${this.transactions.length} van ${this.totalTransactionCount} transacties (meest recent). Gebruik zoek/filter of laad alles voor het volledige overzicht.`;
        }
        return `${this.transactions.length} van ${this.totalTransactionCount} transacties geladen.`;
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
          { value: 'this_year', label: 'Dit jaar tot nu toe' },
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

      // Category charts for statistieken page
      categoryCharts() {
        return this.getCategoryCharts();
      },

      // Left and right category groups for dashboard
      leftCategoryGroups() {
        const groups = this.groupTransactionsByCategory();
        return groups.slice(0, Math.ceil(groups.length / 2));
      },

      rightCategoryGroups() {
        const groups = this.groupTransactionsByCategory();
        return groups.slice(Math.ceil(groups.length / 2));
      },

      // Proxy for category budgets to ensure Vue reactivity
      budgetProxy() {
        return new Proxy(this.categoryBudgets, {
          get: (target, prop) => {
            return target[prop] || 0;
          },
          set: (target, prop, value) => {
            const budget = parseFloat(value) || 0;
            this.$set(target, prop, budget);

            // Save to local storage
            const savedBudgets = { ...target };
            localStorage.setItem('financepro_category_budgets', JSON.stringify(savedBudgets));
            return true;
          }
        });
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
      // Clean up category charts
      if (this.categoryChartsInstances) {
        this.categoryChartsInstances.forEach(chart => chart.destroy());
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
          // Load category budgets after data refresh
          this.loadCategoryBudgets();
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

      toIsoDate(value) {
        const date = value instanceof Date ? value : new Date(value);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      },

      getCategoryStatisticsDateRange() {
        const now = new Date();
        const startDate = new Date(now.getFullYear() - 1, 0, 1);
        const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        return { startDate, endDate };
      },

      async loadInsightsStatsTransactions() {
        const { startDate, endDate } = this.getCategoryStatisticsDateRange();
        let options = {
          sort: '-date',
          filter: `date >= '${this.toIsoDate(startDate)}' && date <= '${this.toIsoDate(endDate)}'`
        };

        try {
          const { items } = await db.listRecords('transactions', options);
          this.insightsStatsTransactions = items;
        } catch (error) {
          if (options.sort === '-date') {
            options.sort = '-id';
            const { items } = await db.listRecords('transactions', options);
            this.insightsStatsTransactions = items;
            return;
          }
          throw error;
        }
      },

      hasActiveTransactionFilters() {
        const filters = this.transactionFilters;
        return Boolean(
          (filters.search && filters.search.trim()) ||
          filters.category ||
          filters.type ||
          filters.period
        );
      },

      analyticsPages() {
        return ['dashboard', 'insights', 'statistieken', 'details'];
      },

      async loadTransactions(mode = 'recent') {
        let options = { sort: '-date' };

        if (mode === 'full' || mode === 'filtered') {
          // all pages
        } else if (mode === 'analytics') {
          const { startDate, endDate } = this.getTimeRangeFilter();
          options.filter = `date >= '${this.toIsoDate(startDate)}' && date <= '${this.toIsoDate(endDate)}'`;
        } else {
          options.maxRecords = TRANSACTIONS_DEFAULT_LIMIT;
        }

        try {
          const { items, totalItems } = await db.listRecords('transactions', options);
          this.transactions = items;
          this.totalTransactionCount = totalItems;
          this.transactionsLoadMode = mode;
          this.transactionTablePage = 1;
          return;
        } catch (error) {
          if (options.sort === '-date') {
            options.sort = '-id';
            const { items, totalItems } = await db.listRecords('transactions', options);
            this.transactions = items;
            this.totalTransactionCount = totalItems;
            this.transactionsLoadMode = mode;
            this.transactionTablePage = 1;
            return;
          }
          throw error;
        }
      },

      async loadAllTransactions() {
        await this.loadTransactions('full');
        this.updateCategoryStats();
        this.updateDashboardData();
        showToast(`${this.transactions.length} transacties geladen`, 'success');
      },

      async refreshData(options = {}) {
        try {
          this.isLoadingTransactions = true;

          const [categories, rules] = await Promise.all([
            db.getCollection('categories'),
            db.getCollection('rules')
          ]);

          this.categories = categories || [];
          this.rules = rules || [];

          let mode = options.mode || 'recent';
          if (options.loadAllTransactions) {
            mode = 'full';
          } else if (this.hasActiveTransactionFilters()) {
            mode = 'full';
          } else if (this.analyticsPages().includes(this.currentPage)) {
            mode = 'analytics';
          }

          await this.loadTransactions(mode);

          if (this.currentPage === 'insights') {
            await this.loadInsightsStatsTransactions();
          }

          this.updateCategoryStats();
          this.updateDashboardData();

          if (this.currentPage === 'insights') {
            this.updateInsightsData();
          }

          console.log(`[FinancePro] Data refreshed (${mode}): ${this.transactions.length}/${this.totalTransactionCount} transactions`);
        } catch (error) {
          console.error('[FinancePro] Error refreshing data:', error);
          showToast('Fout bij het laden van data', 'error');
        } finally {
          this.isLoadingTransactions = false;
        }
      },

      scheduleTransactionFilterReload() {
        clearTimeout(this.transactionFilterDebounce);
        this.transactionFilterDebounce = setTimeout(async () => {
          if (this.currentPage !== 'transactions') return;
          try {
            this.isLoadingTransactions = true;
            if (this.hasActiveTransactionFilters()) {
              await this.loadTransactions('full');
            } else {
              await this.loadTransactions('recent');
            }
            this.updateCategoryStats();
          } catch (error) {
            console.error('[FinancePro] Filter reload failed:', error);
          } finally {
            this.isLoadingTransactions = false;
          }
        }, 350);
      },

      goToTransactionTablePage(page) {
        const next = Math.min(Math.max(1, page), this.transactionTablePageCount);
        this.transactionTablePage = next;
      },


      // ============================================================================
      // NAVIGATION
      // ============================================================================

      changePage(page) {
        console.log('Changing page to:', page);
        this.currentPage = page;
        this.showMobileMenu = false;

        if (page === 'transactions') {
          if (this.hasActiveTransactionFilters()) {
            if (this.transactionsLoadMode !== 'full') {
              this.loadTransactions('full');
            }
          } else if (this.transactionsLoadMode !== 'recent') {
            this.loadTransactions('recent');
          }
        } else if (this.analyticsPages().includes(page)) {
          const loadAnalytics = this.transactionsLoadMode !== 'analytics'
            ? this.loadTransactions('analytics')
            : Promise.resolve();

          loadAnalytics.then(() => {
            this.updateCategoryStats();
            this.updateDashboardData();
            if (page === 'insights') this.updateInsightsData();
          });

          if (page === 'insights') {
            this.loadInsightsStatsTransactions().then(() => {
              this.$forceUpdate();
            });
          }
        }

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

        // Render category charts when navigating to statistieken page
        if (page === 'statistieken') {
          this.$nextTick(() => {
            setTimeout(() => {
              this.renderCategoryCharts();
            }, 100);
          });
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

        if (this.analyticsPages().includes(this.currentPage)) {
          if (this.currentPage === 'insights') {
            this.updateCategoryStats();
            this.updateDashboardData();
            this.updateInsightsData();
            return;
          }

          this.loadTransactions('analytics').then(() => {
            this.updateCategoryStats();
            this.updateDashboardData();
          });
          return;
        }

        // Refresh data when time range changes
        if (this.currentPage === 'insights') {
          this.updateInsightsData();
        } else if (this.currentPage === 'details') {
          // Force update of computed properties
          this.$forceUpdate();
        } else if (this.currentPage === 'categories') {
          // Update category statistics for the new time range
          this.updateCategoryStats();
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
            // Vorige maand: volledige vorige maand (altijd de maand voor de huidige)
            const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            startDate = new Date(lastMonthDate.getFullYear(), lastMonthDate.getMonth(), 1);
            endDate = new Date(lastMonthDate.getFullYear(), lastMonthDate.getMonth() + 1, 0, 23, 59, 59);
            break;
          case 'this_year':
            // Kalenderjaar tot vandaag
            startDate = new Date(now.getFullYear(), 0, 1);
            endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
            break;
          case 'last_6_months':
            // Laatste 6 VOLLEDIGE maanden zonder de huidige maand
            // Bijv. als het nu februari 2026 is: van juli 2025 tot januari 2026
            const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);
            startDate = new Date(sixMonthsAgo.getFullYear(), sixMonthsAgo.getMonth(), 1);
            // Eindigt aan het einde van de vorige maand (januari als het nu februari is)
            const endMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDate = new Date(endMonth.getFullYear(), endMonth.getMonth() + 1, 0, 23, 59, 59);
            break;
          case 'last_12_months':
          default:
            // Laatste 12 VOLLEDIGE maanden zonder de huidige maand
            // Bijv. als het nu februari 2026 is: van februari 2025 tot januari 2026
            const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, 1);
            startDate = new Date(twelveMonthsAgo.getFullYear(), twelveMonthsAgo.getMonth(), 1);
            // Eindigt aan het einde van de vorige maand
            const endMonth12 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDate = new Date(endMonth12.getFullYear(), endMonth12.getMonth() + 1, 0, 23, 59, 59);
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

        // Get balance from the most recent transaction
        const sortedTransactions = [...this.transactions].sort((a, b) => new Date(b.date) - new Date(a.date));
        const latestTransaction = sortedTransactions.find(t => t.balance !== null && t.balance !== undefined);
        this.monthlyBalance = latestTransaction ? latestTransaction.balance : 0;

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
          case 'this_year':
            numMonths = now.getMonth() + 1;
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
        // Calculate months based on the actual time range filter dates
        const startDate = new Date(timeRangeFilter.startDate);
        for (let i = 0; i < numMonths; i++) {
          const date = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
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
          case 'this_year':
            numMonths = now.getMonth() + 1;
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
        // Calculate months based on the actual time range filter dates
        const startDate = new Date(timeRangeFilter.startDate);
        for (let i = 0; i < numMonths; i++) {
          const date = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
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
        // Use current categories that have income transactions
        const categories = this.categories
          .filter(cat => incomeTransactions.some(t => t.category === cat.name))
          .map(cat => cat.name)
          .sort();

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
          case 'this_year':
            numMonths = now.getMonth() + 1;
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
        // Calculate months based on the actual time range filter dates
        const startDate = new Date(timeRangeFilter.startDate);
        for (let i = 0; i < numMonths; i++) {
          const date = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
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
        // Use current categories that have expense transactions
        const categories = this.categories
          .filter(cat => expenseTransactions.some(t => t.category === cat.name))
          .map(cat => cat.name)
          .sort();

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
        // Get time range filter to determine which transactions to include
        const timeRangeFilter = this.getTimeRangeFilter();

        // Add transaction count and total amount to each category
        this.categories.forEach(category => {
          const categoryTransactions = this.transactions.filter(t => t.category === category.name);

          // Filter transactions by the selected time range
          const timeRangeTransactions = categoryTransactions.filter(t => {
            const transactionDate = new Date(t.date);
            return transactionDate >= timeRangeFilter.startDate && transactionDate <= timeRangeFilter.endDate;
          });

          category.transactionCount = categoryTransactions.length;

          // Calculate income and expense totals for the selected time range
          category.incomeTotal = timeRangeTransactions
            .filter(t => t.amount >= 0)
            .reduce((sum, t) => sum + t.amount, 0);

          category.expenseTotal = Math.abs(timeRangeTransactions
            .filter(t => t.amount < 0)
            .reduce((sum, t) => sum + t.amount, 0));

          // Keep totalAmount for backward compatibility (absolute value)
          category.totalAmount = timeRangeTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
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

      renderCategoryCharts() {
        // Destroy existing category charts
        if (this.categoryChartsInstances) {
          this.categoryChartsInstances.forEach(chart => chart.destroy());
        }
        this.categoryChartsInstances = [];

        const charts = this.categoryCharts;
        charts.forEach(chart => {
          const canvasId = 'category-chart-' + chart.category.replace(/\s+/g, '-').toLowerCase();
          const ctx = document.getElementById(canvasId);
          if (!ctx) return;

          const chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
              labels: chart.labels,
              datasets: [{
                label: 'Uitgaven',
                data: chart.expenseData,
                backgroundColor: '#ef4444', // Red for expenses
                borderColor: '#ef4444',
                borderWidth: 1
              }, {
                label: 'Inkomsten',
                data: chart.incomeData,
                backgroundColor: '#10b981', // Green for income
                borderColor: '#10b981',
                borderWidth: 1
              }]
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
                    callback: (value) => '€' + this.formatAmount(value)
                  },
                  grid: { color: '#374151' }
                }
              },
              plugins: {
                legend: {
                  labels: { color: '#9ca3af' },
                  position: 'top'
                }
              }
            }
          });

          this.categoryChartsInstances.push(chartInstance);
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
          case 'this_year':
            numMonths = now.getMonth() + 1;
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
        // Calculate months based on the actual time range filter dates
        const startDate = new Date(timeRangeFilter.startDate);
        for (let i = 0; i < numMonths; i++) {
          const date = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
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
          case 'this_year':
            numMonths = now.getMonth() + 1;
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
        const previousYear = currentYear - 1;

        // Get all categories from current category list
        const categories = this.categories.map(cat => cat.name).sort();

        const transactionSource =
          this.currentPage === 'insights' && this.insightsStatsTransactions.length
            ? this.insightsStatsTransactions
            : this.transactions;

        // Filter transactions by account if selected
        let filteredTransactions = this.selectedAccount
          ? transactionSource.filter(t => t.account === this.selectedAccount)
          : transactionSource;

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

          const last12MonthsRolling = [];
          for (let i = 11; i >= 0; i--) {
            const date = new Date(currentYear, currentMonth - i, 1);
            last12MonthsRolling.push(monthlyTotals[`${date.getFullYear()}-${date.getMonth()}`] || 0);
          }
          const last12MonthsWithData = last12MonthsRolling.filter(amount => amount > 0);
          const avgLast12Months = last12MonthsWithData.length > 0
            ? last12MonthsWithData.reduce((sum, val) => sum + val, 0) / last12MonthsWithData.length
            : 0;

          const last6MonthsRolling = [];
          for (let i = 5; i >= 0; i--) {
            const date = new Date(currentYear, currentMonth - i, 1);
            last6MonthsRolling.push(monthlyTotals[`${date.getFullYear()}-${date.getMonth()}`] || 0);
          }
          const last6MonthsWithData = last6MonthsRolling.filter(amount => amount > 0);
          const avgLast6Months = last6MonthsWithData.length > 0
            ? last6MonthsWithData.reduce((sum, val) => sum + val, 0) / last6MonthsWithData.length
            : 0;

          const previousYearMonths = [];
          for (let month = 0; month < 12; month++) {
            previousYearMonths.push(monthlyTotals[`${previousYear}-${month}`] || 0);
          }
          const avgPreviousYear = previousYearMonths.reduce((sum, val) => sum + val, 0) / 12;

          statistics[category] = {
            thisMonth,
            lastMonth,
            avgLast12Months,
            avgLast6Months,
            avgPreviousYear,
            // Helper for color logic: true if this month is higher than last month (worse)
            isThisMonthHigher: thisMonth > lastMonth
          };
        });

        return statistics;
      },

      getCategoryCharts() {
        const now = new Date();
        const charts = [];

        this.categories.forEach(category => {
          const categoryTransactions = this.transactions.filter(t => t.category === category.name);

          // Calculate separate data for income and expenses
          const incomeData = [];
          const expenseData = [];
          const months = [];

          for (let i = 11; i >= 0; i--) {
            const date = new Date(now.getFullYear(), now.getMonth() - i, 1);

            const monthTransactions = categoryTransactions.filter(t => {
              const transactionDate = new Date(t.date);
              return transactionDate.getFullYear() === date.getFullYear() &&
                     transactionDate.getMonth() === date.getMonth();
            });

            // Calculate income and expenses separately
            const income = monthTransactions
              .filter(t => t.amount >= 0)
              .reduce((sum, t) => sum + t.amount, 0);

            const expenses = monthTransactions
              .filter(t => t.amount < 0)
              .reduce((sum, t) => sum + Math.abs(t.amount), 0);

            incomeData.push(income);
            expenseData.push(expenses);
            months.push(date.toLocaleDateString('nl-NL', { month: 'short', year: '2-digit' }));
          }

          // Calculate totals
          const totalIncome = incomeData.reduce((sum, amount) => sum + amount, 0);
          const totalExpenses = expenseData.reduce((sum, amount) => sum + amount, 0);
          const netTotal = totalIncome - totalExpenses;

          charts.push({
            category: category.name,
            color: category.color,
            incomeData: incomeData,
            expenseData: expenseData,
            labels: months,
            totalIncome: totalIncome,
            totalExpenses: totalExpenses,
            netTotal: netTotal
          });
        });

        return charts;
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
          case 'this_year':
            numMonths = now.getMonth() + 1;
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
            await db.saveDocument('transactions', {
              ...this.editingTransaction,
              ...processedData
            });
            showToast('Transactie bijgewerkt', 'success');
          } else {
            // Create new transaction
            await db.saveDocument('transactions', processedData);
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
          await db.deleteDocument('transactions', transactionId);
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
            color: this.categoryForm.color,
            budget: this.editingCategory ? this.editingCategory.budget : 0
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
            const oldCategoryName = this.editingCategory.name;
            const newCategoryName = categoryData.name;

            // If category name changed, update all transactions with the old name
            if (oldCategoryName !== newCategoryName) {
              const transactionsToUpdate = this.transactions.filter(t => t.category === oldCategoryName);
              for (const transaction of transactionsToUpdate) {
                await db.saveDocument('transactions', {
                  ...transaction,
                  category: newCategoryName
                });
              }
            }

            await db.saveDocument('categories', {
              ...this.editingCategory,
              ...categoryData
            });
            showToast('Categorie bijgewerkt', 'success');
          } else {
            // Create new category
            await db.saveDocument('categories', categoryData);
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
              await db.saveDocument('categories', {
                name: 'Not defined',
                color: '#6b7280',
                budget: 0
              });
              this.categories = await db.getCollection('categories') || [];
              notDefinedCategory = this.categories.find(c => c.name === 'Not defined');
            }

            // Update all transactions to use "Not defined"
            for (const transaction of transactionsUsingCategory) {
              await db.saveDocument('transactions', {
                ...transaction,
                category: 'Not defined'
              });
            }
          }

          // Delete the category
          await db.deleteDocument('categories', categoryId);
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

      getCategoryBudget(categoryName) {
        return this.categoryBudgets[categoryName] || 0;
      },

      updateCategoryBudget(categoryName, budgetValue) {
        const budget = parseFloat(budgetValue) || 0;

        // Update reactive data
        this.$set(this.categoryBudgets, categoryName, budget);

        // Save to local storage
        const savedBudgets = { ...this.categoryBudgets };
        localStorage.setItem('financepro_category_budgets', JSON.stringify(savedBudgets));
      },

      loadCategoryBudgets() {
        const savedBudgets = JSON.parse(localStorage.getItem('financepro_category_budgets') || '{}');
        this.categoryBudgets = { ...savedBudgets };
      },

      getAmountColor(amount, budget) {
        if (!budget || budget === 0) return 'text-white';
        return amount > budget ? 'text-red-400' : 'text-green-400';
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
              await db.saveDocument('transactions', {
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
            await db.deleteDocument('transactions', transactionId);
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
            await db.saveDocument('rules', {
              ...this.editingRule,
              ...ruleData
            });
            showToast('Regel bijgewerkt', 'success');
          } else {
            // Create new rule
            await db.saveDocument('rules', ruleData);
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
          await db.deleteDocument('rules', ruleId);
          showToast('Regel verwijderd', 'success');
          await this.refreshData();
        } catch (error) {
          console.error('Error deleting rule:', error);
          showToast('Fout bij verwijderen regel', 'error');
        }
      },

      async toggleRuleActive(rule) {
        try {
          await db.saveDocument('rules', {
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

      didRuleActionChangeTransaction(before, after, action) {
        switch (action.type) {
          case 'set_category':
            return before.category !== after.category;
          case 'set_description':
            return before.description !== after.description;
          default:
            return false;
        }
      },

      async applyRuleToExistingRecords(rule) {
        if (this.applyingRuleId) return;

        if (!confirm(`Regel "${rule.name}" nu toepassen op alle bestaande transacties?`)) {
          return;
        }

        this.applyingRuleId = rule.id;
        try {
          this.isLoadingTransactions = true;
          const { items: allTransactions } = await db.listRecords('transactions', { sort: '-date' });
          let appliedTimes = 0;

          for (const transaction of allTransactions) {
            if (!this.checkRuleCondition(transaction, rule.condition)) {
              continue;
            }

            const processed = this.applyRuleAction(transaction, rule.action);
            if (!this.didRuleActionChangeTransaction(transaction, processed, rule.action)) {
              continue;
            }

            await db.saveDocument('transactions', processed);
            appliedTimes++;
          }

          if (appliedTimes > 0) {
            await db.saveDocument('rules', {
              ...rule,
              appliedCount: (rule.appliedCount || 0) + appliedTimes
            });
          }

          await this.refreshData();
          showToast(
            appliedTimes > 0
              ? `Regel toegepast op ${appliedTimes} transactie(s)`
              : 'Geen transacties gewijzigd (geen matches of stond al goed)',
            appliedTimes > 0 ? 'success' : 'info'
          );
        } catch (error) {
          console.error('Error applying rule to existing records:', error);
          showToast('Fout bij toepassen regel', 'error');
        } finally {
          this.applyingRuleId = null;
          this.isLoadingTransactions = false;
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
            await db.saveDocument('rules', {
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
          await db.saveDocument('transactions', transaction);
        }

        if (updatedTransactions.length > 0) {
          console.log(`[FinancePro] Applied rules to ${updatedTransactions.length} transactions`);
        }
      },

      checkRuleCondition(transaction, condition) {
        const fieldValue = transaction[condition.field];
        if (fieldValue == null || fieldValue === '') {
          return false;
        }

        const conditionValue = condition.value.toLowerCase();
        const fieldValueLower = String(fieldValue).toLowerCase();

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
            this.csvColumns = parseCsvRow(lines[0], delimiter);
          }

          this.csvPreview = lines.slice(1, 6).map(line => parseCsvRow(line, delimiter).join(' | '));

          // Auto-detect columns if possible
          this.autoDetectColumns();
        } catch (error) {
          console.error('Error parsing CSV text:', error);
        }
      },

      autoDetectColumns() {
        if (!this.csvColumns || this.csvColumns.length === 0) return;

        Object.keys(this.csvMapping).forEach(key => {
          if (key !== 'delimiter') this.csvMapping[key] = '';
        });

        const normalized = this.csvColumns.map((name, index) => ({
          index,
          lower: name.toLowerCase().trim()
        }));

        const pick = (rules) => {
          for (const rule of rules) {
            const match = normalized.find(col => rule.test(col.lower));
            if (match) return match.index.toString();
          }
          return '';
        };

        this.csvMapping.date = pick([/^datum$/, /\bdatum\b/]);
        this.csvMapping.name = pick([/^naam$/, /^name$/]);
        this.csvMapping.description = pick([/^omschrijving$/, /\bomschrijving\b/, /\bdescription\b/, /\bmemo\b/]);
        this.csvMapping.amount = pick([
          /bedrag bij\s*\/?\s*af/,
          /^bedrag$/,
          /\bbedrag\b/
        ]);
        this.csvMapping.balance = pick([/saldo voor boeking/, /^saldo$/, /\bbalance\b/]);
        this.csvMapping.account = pick([/^van\s*\/?\s*naar$/, /\bvan\s*\/?\s*naar\b/, /^tegenrekening$/]);
        if (!this.csvMapping.account) {
          this.csvMapping.account = pick([/^je rekening$/, /\brekening\b/]);
        }
        this.csvMapping.category = pick([/^categorie$/, /^category$/]);

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
            this.csvColumns = parseCsvRow(lines[0], delimiter);
          }

          this.csvPreview = lines.slice(1, 6).map(line => parseCsvRow(line, delimiter).join(' | '));
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
            await db.saveDocument('categories', {
              name: 'Not defined',
              color: '#6b7280',
              budget: 0
            });
            // Refresh categories list
            this.categories = await db.getCollection('categories') || [];
          } catch (error) {
            console.warn('[FinancePro] Could not create "Not defined" category:', error);
          }
        }

        try {
          const csvText = await this.selectedCsvFile.text();
          if (this.transactionsLoadMode !== 'full') {
            await this.loadTransactions('full');
          }
          const parseResult = await this.parseCsvData(csvText);
          const importedTransactions = parseResult.transactions;
          const csvDuplicateCount = parseResult.duplicateCount;
          const skippedInvalid = parseResult.skippedInvalid || 0;

          if (importedTransactions.length === 0 && csvDuplicateCount === 0) {
            const skipHint = skippedInvalid > 0
              ? ` (${skippedInvalid} regels overgeslagen: check kolom mapping of CSV-formaat)`
              : '';
            showToast(`Geen geldige transacties gevonden. Controleer de kolom mapping.${skipHint}`, 'error');
            return;
          }

          if (importedTransactions.length === 0 && csvDuplicateCount > 0) {
            showToast(`Alle ${csvDuplicateCount} transacties waren al aanwezig (duplicates overgeslagen)`, 'info');
            this.closeCsvImportModal();
            return;
          }

          let importedCount = 0;
          let duplicateCount = 0;
          let failedSaveCount = 0;

          for (const transaction of importedTransactions) {
            try {
              // Apply rules before saving
              const processedTransaction = await this.applyRulesToTransaction(transaction);
              await db.saveDocument('transactions', processedTransaction);
              importedCount++;
            } catch (error) {
              failedSaveCount++;
              console.warn('Failed to import transaction:', transaction, error);
            }
          }

          if (csvDuplicateCount > 0 || skippedInvalid > 0 || failedSaveCount > 0) {
            const parts = [`${importedCount} transacties geïmporteerd`];
            if (csvDuplicateCount > 0) parts.push(`${csvDuplicateCount} duplicates overgeslagen`);
            if (skippedInvalid > 0) parts.push(`${skippedInvalid} ongeldige regels overgeslagen`);
            if (failedSaveCount > 0) parts.push(`${failedSaveCount} mislukt bij opslaan`);
            showToast(parts.join(', '), failedSaveCount > 0 ? 'error' : 'success');
          } else {
            showToast(`${importedCount} transacties geïmporteerd`, 'success');
          }
          this.closeCsvImportModal();
          await this.loadTransactions('full');
          this.updateCategoryStats();
          this.updateDashboardData();
        } catch (error) {
          console.error('Error processing CSV:', error);
          showToast('Fout bij verwerken CSV bestand', 'error');
        }
      },

      async parseCsvData(csvText) {
        const lines = csvText.split(/\r?\n/).filter(line => line.trim());
        const delimiter = this.csvMapping.delimiter;
        const dateIndex = this.csvMapping.date !== '' ? parseInt(this.csvMapping.date, 10) : -1;
        const nameIndex = this.csvMapping.name !== '' ? parseInt(this.csvMapping.name, 10) : -1;
        const descriptionIndex = this.csvMapping.description !== '' ? parseInt(this.csvMapping.description, 10) : -1;
        const amountIndex = this.csvMapping.amount !== '' ? parseInt(this.csvMapping.amount, 10) : -1;
        const balanceIndex = this.csvMapping.balance !== '' ? parseInt(this.csvMapping.balance, 10) : -1;
        const accountIndex = this.csvMapping.account !== '' ? parseInt(this.csvMapping.account, 10) : -1;
        const categoryIndex = this.csvMapping.category !== '' ? parseInt(this.csvMapping.category, 10) : -1;

        const transactions = [];
        let duplicateCount = 0;
        let skippedInvalid = 0;

        if (dateIndex === -1 || amountIndex === -1) {
          return { transactions, duplicateCount, skippedInvalid };
        }

        const getCell = (columns, index) => (index >= 0 && index < columns.length ? columns[index] : '');

        for (let i = 1; i < lines.length; i++) {
          const columns = parseCsvRow(lines[i], delimiter);

          const indices = [dateIndex, nameIndex, descriptionIndex, amountIndex, balanceIndex, accountIndex, categoryIndex].filter(idx => idx !== -1);
          const maxIndex = indices.length > 0 ? Math.max(...indices) : 0;
          if (columns.length <= maxIndex) {
            skippedInvalid += 1;
            continue;
          }

          const dateStr = getCell(columns, dateIndex);
          const nameStr = getCell(columns, nameIndex);
          const description = getCell(columns, descriptionIndex);
          const amountStr = getCell(columns, amountIndex);
          const balanceStr = getCell(columns, balanceIndex);
          const accountStr = getCell(columns, accountIndex);
          const categoryStr = getCell(columns, categoryIndex);

          const date = parseCsvDate(dateStr);
          if (!date) {
            skippedInvalid += 1;
            continue;
          }

          const amount = parseCsvAmount(amountStr);
          if (Number.isNaN(amount)) {
            skippedInvalid += 1;
            continue;
          }

          let finalDescription = '';
          if (nameStr) finalDescription += nameStr;
          if (description) finalDescription += (finalDescription ? ' - ' : '') + description;
          if (!finalDescription) finalDescription = 'Geen omschrijving';

          const nameValue = (nameStr && nameStr.trim())
            ? nameStr.trim()
            : finalDescription.slice(0, 500);

          let finalCategory = 'Not defined';
          if (categoryStr) {
            const existingCategory = this.categories.find(c =>
              c.name.toLowerCase() === categoryStr.toLowerCase().trim()
            );
            if (existingCategory) {
              finalCategory = existingCategory.name;
            } else {
              const newCategory = {
                name: categoryStr.trim(),
                color: '#6b7280',
                budget: 0
              };
              try {
                await db.saveDocument('categories', newCategory);
                this.categories.push(newCategory);
                finalCategory = newCategory.name;
              } catch (error) {
                console.warn('[FinancePro] Could not create category:', categoryStr, error);
              }
            }
          }

          const newTransaction = {
            date,
            name: nameValue,
            description: finalDescription,
            amount,
            balance: balanceStr ? parseCsvAmount(balanceStr) : null,
            category: finalCategory,
            account: accountStr || ''
          };

          if (!this.isDuplicateTransaction(newTransaction)) {
            transactions.push(newTransaction);
          } else {
            duplicateCount += 1;
          }
        }

        return { transactions, duplicateCount, skippedInvalid };
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
      this.$watch(
        () => ({ ...this.transactionFilters }),
        () => {
          this.transactionTablePage = 1;
          this.scheduleTransactionFilterReload();
        },
        { deep: true }
      );

      // Load saved theme
      const savedTheme = localStorage.getItem('financepro_theme') || 'indigo';
      this.settings.themeColor = savedTheme;
      document.documentElement.setAttribute('data-theme', savedTheme);

      // Auto-login for demo (in production, this would be proper authentication)
      if (!this.isAuthenticated) {
        this.loginForm.username = 'demo_user';
        this.login();
      } else {
        // If already authenticated, load category budgets
        this.loadCategoryBudgets();
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

