/// <reference path="../pb_data/types.d.ts" />

migrate(
    (app) => {
        const clientRule =
            '@request.headers.x_client_id != "" && client_id = @request.headers.x_client_id';
        const createRule = '@request.headers.x_client_id != ""';

        const clientIdField = {
            name: "client_id",
            type: "text",
            required: true,
            min: 1,
            max: 255,
        };

        const transactions = new Collection({
            name: "transactions",
            type: "base",
            listRule: clientRule,
            viewRule: clientRule,
            createRule: createRule,
            updateRule: clientRule,
            deleteRule: clientRule,
            fields: [
                clientIdField,
                { name: "date", type: "text", required: true, max: 32 },
                { name: "name", type: "text", required: true, max: 500 },
                { name: "description", type: "text", required: false, max: 2000 },
                { name: "amount", type: "number", required: true },
                { name: "balance", type: "number", required: false },
                { name: "account", type: "text", required: false, max: 255 },
                { name: "category", type: "text", required: false, max: 255 },
            ],
            indexes: [
                "CREATE INDEX idx_transactions_client_id ON transactions (client_id)",
                "CREATE INDEX idx_transactions_client_date ON transactions (client_id, date)",
            ],
        });

        const categories = new Collection({
            name: "categories",
            type: "base",
            listRule: clientRule,
            viewRule: clientRule,
            createRule: createRule,
            updateRule: clientRule,
            deleteRule: clientRule,
            fields: [
                clientIdField,
                { name: "name", type: "text", required: true, max: 255 },
                { name: "color", type: "text", required: false, max: 32 },
                { name: "budget", type: "number", required: false },
            ],
            indexes: [
                "CREATE INDEX idx_categories_client_id ON categories (client_id)",
            ],
        });

        const rules = new Collection({
            name: "rules",
            type: "base",
            listRule: clientRule,
            viewRule: clientRule,
            createRule: createRule,
            updateRule: clientRule,
            deleteRule: clientRule,
            fields: [
                clientIdField,
                { name: "name", type: "text", required: true, max: 255 },
                { name: "condition", type: "json", required: true, maxSize: 2000000 },
                { name: "action", type: "json", required: true, maxSize: 2000000 },
                { name: "active", type: "bool", required: false },
                { name: "appliedCount", type: "number", required: false },
            ],
            indexes: ["CREATE INDEX idx_rules_client_id ON rules (client_id)"],
        });

        app.save(transactions);
        app.save(categories);
        app.save(rules);
    },
    (app) => {
        for (const name of ["rules", "categories", "transactions"]) {
            try {
                const collection = app.findCollectionByNameOrId(name);
                app.delete(collection);
            } catch (_) {
                // already removed
            }
        }
    }
);
