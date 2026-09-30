/// <reference path="../pb_data/types.d.ts" />

migrate(
    (app) => {
        const collection = app.findCollectionByNameOrId("rules");
        collection.fields.add(
            new Field({
                name: "rule_category",
                type: "text",
                required: false,
                max: 255,
            })
        );
        app.save(collection);
    },
    (app) => {
        const collection = app.findCollectionByNameOrId("rules");
        collection.fields.removeByName("rule_category");
        app.save(collection);
    }
);
