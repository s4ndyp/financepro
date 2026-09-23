/// <reference path="../pb_data/types.d.ts" />

migrate(
    (app) => {
        const collection = app.findCollectionByNameOrId("transactions");
        if (!collection) return;

        const hasOwnAccount = collection.fields.find((field) => field.name === "own_account");
        if (hasOwnAccount) return;

        collection.fields.add(
            new Field({
                name: "own_account",
                type: "text",
                required: false,
                max: 255,
            })
        );

        app.save(collection);
    },
    (app) => {
        const collection = app.findCollectionByNameOrId("transactions");
        if (!collection) return;

        const ownAccountField = collection.fields.find((field) => field.name === "own_account");
        if (!ownAccountField) return;

        collection.fields.removeById(ownAccountField.id);
        app.save(collection);
    }
);
