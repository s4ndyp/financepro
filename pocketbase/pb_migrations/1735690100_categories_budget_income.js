/// <reference path="../pb_data/types.d.ts" />

migrate(
    (app) => {
        const collection = app.findCollectionByNameOrId("categories");
        collection.fields.add(
            new Field({
                name: "budget_income",
                type: "number",
                required: false,
            })
        );
        app.save(collection);
    },
    (app) => {
        const collection = app.findCollectionByNameOrId("categories");
        collection.fields.removeByName("budget_income");
        app.save(collection);
    }
);
