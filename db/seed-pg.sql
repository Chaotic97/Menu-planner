-- EU 14 Allergen Keyword Mappings (PostgreSQL version)
INSERT INTO allergen_keywords (keyword, allergen) VALUES
-- CELERY
('celery', 'celery'), ('celeriac', 'celery'),
-- GLUTEN
('wheat', 'gluten'), ('flour', 'gluten'), ('bread', 'gluten'), ('breadcrumb', 'gluten'),
('breadcrumbs', 'gluten'), ('pasta', 'gluten'), ('noodle', 'gluten'), ('noodles', 'gluten'),
('couscous', 'gluten'), ('barley', 'gluten'), ('rye', 'gluten'), ('oat', 'gluten'),
('oats', 'gluten'), ('spelt', 'gluten'), ('semolina', 'gluten'), ('bulgur', 'gluten'),
('farro', 'gluten'), ('tortilla', 'gluten'), ('crouton', 'gluten'), ('croutons', 'gluten'),
('panko', 'gluten'), ('soy sauce', 'gluten'),
-- CRUSTACEANS
('shrimp', 'crustaceans'), ('prawn', 'crustaceans'), ('prawns', 'crustaceans'),
('crab', 'crustaceans'), ('lobster', 'crustaceans'), ('crayfish', 'crustaceans'),
('langoustine', 'crustaceans'), ('scampi', 'crustaceans'),
-- EGGS
('egg', 'eggs'), ('eggs', 'eggs'), ('mayonnaise', 'eggs'), ('mayo', 'eggs'),
('meringue', 'eggs'), ('aioli', 'eggs'), ('custard', 'eggs'), ('hollandaise', 'eggs'),
('brioche', 'eggs'),
-- FISH
('salmon', 'fish'), ('tuna', 'fish'), ('cod', 'fish'), ('haddock', 'fish'),
('anchovy', 'fish'), ('anchovies', 'fish'), ('sardine', 'fish'), ('sardines', 'fish'),
('mackerel', 'fish'), ('trout', 'fish'), ('bass', 'fish'), ('bream', 'fish'),
('halibut', 'fish'), ('sole', 'fish'), ('swordfish', 'fish'), ('snapper', 'fish'),
('tilapia', 'fish'), ('fish sauce', 'fish'), ('worcestershire', 'fish'),
-- LUPIN
('lupin', 'lupin'), ('lupini', 'lupin'),
-- MILK
('milk', 'milk'), ('cream', 'milk'), ('butter', 'milk'), ('cheese', 'milk'),
('yogurt', 'milk'), ('yoghurt', 'milk'), ('whey', 'milk'), ('casein', 'milk'),
('ghee', 'milk'), ('mascarpone', 'milk'), ('ricotta', 'milk'), ('mozzarella', 'milk'),
('parmesan', 'milk'), ('cheddar', 'milk'), ('brie', 'milk'), ('camembert', 'milk'),
('gruyere', 'milk'), ('gouda', 'milk'), ('paneer', 'milk'), ('bechamel', 'milk'),
('creme fraiche', 'milk'),
-- MOLLUSCS
('mussel', 'molluscs'), ('mussels', 'molluscs'), ('clam', 'molluscs'), ('clams', 'molluscs'),
('oyster', 'molluscs'), ('oysters', 'molluscs'), ('squid', 'molluscs'), ('calamari', 'molluscs'),
('octopus', 'molluscs'), ('snail', 'molluscs'), ('escargot', 'molluscs'),
('scallop', 'molluscs'), ('scallops', 'molluscs'),
-- MUSTARD
('mustard', 'mustard'), ('dijon', 'mustard'),
-- NUTS
('almond', 'nuts'), ('almonds', 'nuts'), ('walnut', 'nuts'), ('walnuts', 'nuts'),
('cashew', 'nuts'), ('cashews', 'nuts'), ('pistachio', 'nuts'), ('pistachios', 'nuts'),
('pecan', 'nuts'), ('pecans', 'nuts'), ('hazelnut', 'nuts'), ('hazelnuts', 'nuts'),
('macadamia', 'nuts'), ('praline', 'nuts'), ('marzipan', 'nuts'), ('frangipane', 'nuts'),
('nougat', 'nuts'),
-- PEANUTS
('peanut', 'peanuts'), ('peanuts', 'peanuts'), ('groundnut', 'peanuts'), ('satay', 'peanuts'),
-- SESAME
('sesame', 'sesame'), ('tahini', 'sesame'), ('halvah', 'sesame'), ('halva', 'sesame'),
-- SOY
('soy', 'soy'), ('soya', 'soy'), ('tofu', 'soy'), ('tempeh', 'soy'),
('edamame', 'soy'), ('miso', 'soy'), ('tamari', 'soy'),
-- SULPHITES
('wine', 'sulphites'), ('vinegar', 'sulphites'), ('molasses', 'sulphites'),
('sulphite', 'sulphites'), ('sulfite', 'sulphites')
ON CONFLICT DO NOTHING;
