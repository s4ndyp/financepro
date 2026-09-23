/// <reference path="../pb_data/types.d.ts" />

migrate(
    (app) => {
        const collection = app.findCollectionByNameOrId("transactions");
        if (!collection) return;

        const hasBalance = collection.fields.find((field) => field.name === "balance");
        if (hasBalance) return;

        collection.fields.add(
            new Field({
                name: "balance",
                type: "number",
                required: false,
            })
        );

        app.save(collection);
    },
    (app) => {
        const collection = app.findCollectionByNameOrId("transactions");
        if (!collection) return;

        const balanceField = collection.fields.find((field) => field.name === "balance");
        if (!balanceField) return;

        collection.fields.removeById(balanceField.id);
        app.save(collection);
    }
);
