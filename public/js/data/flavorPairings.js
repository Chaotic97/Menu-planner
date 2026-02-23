// Flavor pairing database based on general culinary knowledge
// Inspired by the study of ingredient flavor compounds and classical cuisine

export const FLAVOR_PAIRINGS = [
  // ── PROTEINS ──────────────────────────────────────────────────────────────
  {
    id: 'chicken', name: 'Chicken', category: 'Poultry',
    flavor_profile: ['savory', 'mild', 'umami'],
    pairings: ['lemon', 'garlic', 'thyme', 'rosemary', 'tarragon', 'sage', 'mushroom',
      'cream', 'white wine', 'butter', 'dijon mustard', 'onion', 'leek', 'parsley',
      'bay leaf', 'paprika', 'ginger', 'soy sauce', 'honey', 'orange', 'tomato',
      'bacon', 'capers', 'olives', 'preserved lemon', 'miso'],
    notes: 'Mild protein that absorbs surrounding flavors. Pairs with both bright acids and rich fats.',
  },
  {
    id: 'beef', name: 'Beef', category: 'Protein',
    flavor_profile: ['rich', 'savory', 'umami', 'fatty'],
    pairings: ['red wine', 'thyme', 'rosemary', 'garlic', 'shallot', 'mushroom',
      'black pepper', 'blue cheese', 'horseradish', 'mustard', 'onion', 'tomato',
      'anchovy', 'worcestershire', 'soy sauce', 'truffle', 'butter', 'bone marrow',
      'beetroot', 'caramelised onion', 'chimichurri herbs', 'parsley'],
    notes: 'Rich umami protein. Benefits from acid, char, and complementary umami boosters.',
  },
  {
    id: 'pork', name: 'Pork', category: 'Protein',
    flavor_profile: ['savory', 'sweet', 'fatty', 'mild'],
    pairings: ['apple', 'sage', 'fennel', 'mustard', 'garlic', 'thyme', 'rosemary',
      'honey', 'soy sauce', 'ginger', 'five spice', 'chili', 'orange', 'maple',
      'cabbage', 'onion', 'bay leaf', 'juniper', 'cider vinegar', 'plum', 'cherry',
      'black pepper', 'clove', 'miso'],
    notes: 'Sweet fat pairs beautifully with fruit acidity and warming spices.',
  },
  {
    id: 'lamb', name: 'Lamb', category: 'Protein',
    flavor_profile: ['rich', 'gamey', 'savory', 'aromatic'],
    pairings: ['rosemary', 'garlic', 'mint', 'thyme', 'oregano', 'lemon', 'red wine',
      'anchovy', 'capers', 'olive oil', 'cumin', 'coriander', 'harissa', 'ras el hanout',
      'yogurt', 'pomegranate', 'aubergine', 'onion', 'bay leaf', 'mustard', 'black olive',
      'tomato', 'spinach', 'chickpeas', 'feta'],
    notes: 'Bold flavor that pairs with aromatic herbs, bright acids, and Mediterranean spices.',
  },
  {
    id: 'duck', name: 'Duck', category: 'Poultry',
    flavor_profile: ['rich', 'fatty', 'gamey', 'savory'],
    pairings: ['orange', 'cherry', 'red wine', 'plum', 'blackberry', 'fig', 'honey',
      'ginger', 'five spice', 'soy sauce', 'balsamic vinegar', 'thyme', 'juniper',
      'lavender', 'port', 'turnip', 'beetroot', 'lentils', 'radicchio'],
    notes: 'Rich fatty bird that needs acid and fruit to cut through. Chinese five spice is classic.',
  },
  {
    id: 'salmon', name: 'Salmon', category: 'Fish',
    flavor_profile: ['rich', 'fatty', 'savory', 'mild'],
    pairings: ['lemon', 'dill', 'capers', 'cream cheese', 'crème fraîche', 'soy sauce',
      'ginger', 'miso', 'honey', 'mustard', 'avocado', 'cucumber', 'beetroot',
      'asparagus', 'fennel', 'pea', 'butter', 'white wine', 'shallot', 'sorrel',
      'horseradish', 'orange', 'teriyaki'],
    notes: 'Rich oil pairs well with acid, dill, and Asian flavors.',
  },
  {
    id: 'cod', name: 'Cod / White Fish', category: 'Fish',
    flavor_profile: ['mild', 'flaky', 'delicate'],
    pairings: ['lemon', 'butter', 'parsley', 'capers', 'tomato', 'olive oil', 'garlic',
      'thyme', 'paprika', 'chorizo', 'saffron', 'leek', 'pea', 'cream', 'white wine',
      'anchovy', 'preserved lemon', 'coriander', 'potato', 'spinach'],
    notes: 'Delicate white flesh that needs support from bold accompaniments.',
  },
  {
    id: 'scallop', name: 'Scallop', category: 'Shellfish',
    flavor_profile: ['sweet', 'briny', 'delicate', 'umami'],
    pairings: ['butter', 'lemon', 'cream', 'cauliflower', 'pea', 'truffle', 'bacon',
      'pancetta', 'shallot', 'white wine', 'chive', 'tarragon', 'celeriac',
      'pumpkin', 'parsnip', 'miso', 'ginger', 'vanilla', 'hazelnut'],
    notes: 'Sweet and delicate — brown butter, acid, and creamy purées are natural partners.',
  },
  {
    id: 'shrimp', name: 'Shrimp / Prawn', category: 'Shellfish',
    flavor_profile: ['sweet', 'briny', 'savory'],
    pairings: ['garlic', 'butter', 'lemon', 'chili', 'ginger', 'soy sauce', 'coconut',
      'lime', 'coriander', 'tomato', 'white wine', 'cream', 'avocado', 'paprika',
      'chorizo', 'tarragon', 'dill', 'mango', 'pineapple'],
    notes: 'Versatile shellfish that works across Asian, Mediterranean, and Latin flavors.',
  },

  // ── VEGETABLES ────────────────────────────────────────────────────────────
  {
    id: 'asparagus', name: 'Asparagus', category: 'Vegetable',
    flavor_profile: ['vegetal', 'bitter', 'bright'],
    pairings: ['butter', 'parmesan', 'lemon', 'egg', 'hollandaise', 'prosciutto',
      'salmon', 'shrimp', 'truffle', 'tarragon', 'dill', 'shallot', 'garlic',
      'hazelnut', 'goat cheese', 'cream', 'white wine', 'mint'],
    notes: 'Bright vegetal flavour pairs well with rich fats, eggs, and gentle acids.',
  },
  {
    id: 'beetroot', name: 'Beetroot', category: 'Vegetable',
    flavor_profile: ['earthy', 'sweet', 'mineral'],
    pairings: ['goat cheese', 'feta', 'blue cheese', 'walnut', 'orange', 'horseradish',
      'dill', 'apple', 'balsamic vinegar', 'red wine', 'smoked salmon', 'duck',
      'lamb', 'cumin', 'yogurt', 'tarragon', 'shallot', 'hazelnut'],
    notes: 'Earthy sweetness is lifted by acid and tang. Classic with goat cheese.',
  },
  {
    id: 'carrot', name: 'Carrot', category: 'Vegetable',
    flavor_profile: ['sweet', 'earthy'],
    pairings: ['ginger', 'cumin', 'coriander', 'orange', 'honey', 'butter', 'thyme',
      'dill', 'parsley', 'nutmeg', 'star anise', 'sesame', 'miso', 'tahini',
      'yogurt', 'garlic', 'cinnamon', 'cardamom', 'lemon'],
    notes: 'Natural sweetness pairs with warming spices and aromatic herbs.',
  },
  {
    id: 'cauliflower', name: 'Cauliflower', category: 'Vegetable',
    flavor_profile: ['mild', 'nutty', 'vegetal'],
    pairings: ['butter', 'cream', 'parmesan', 'truffle', 'curry', 'cumin', 'coriander',
      'turmeric', 'chili', 'anchovy', 'capers', 'raisin', 'cheddar', 'bacon',
      'tahini', 'lemon', 'hazelnut', 'almond', 'pomegranate', 'scallop'],
    notes: 'Versatile — roasts to nuttiness and absorbs bold spices beautifully.',
  },
  {
    id: 'mushroom', name: 'Mushroom', category: 'Vegetable',
    flavor_profile: ['umami', 'earthy', 'savory'],
    pairings: ['garlic', 'thyme', 'butter', 'cream', 'shallot', 'parsley', 'truffle',
      'soy sauce', 'miso', 'egg', 'parmesan', 'leek', 'tarragon', 'white wine',
      'brandy', 'bacon', 'beef', 'chicken', 'polenta', 'pasta', 'hazlenut'],
    notes: 'Powerful umami that pairs with other savory and earthy flavors.',
  },
  {
    id: 'pea', name: 'Pea / Garden Pea', category: 'Vegetable',
    flavor_profile: ['sweet', 'fresh', 'vegetal'],
    pairings: ['mint', 'butter', 'cream', 'prosciutto', 'bacon', 'shallot', 'parmesan',
      'lemon', 'ricotta', 'salmon', 'scallop', 'asparagus', 'tarragon', 'dill',
      'goat cheese', 'pasta', 'risotto'],
    notes: 'Sweet freshness pairs with mint, cured meats, and dairy.',
  },
  {
    id: 'tomato', name: 'Tomato', category: 'Vegetable / Fruit',
    flavor_profile: ['acid', 'sweet', 'umami'],
    pairings: ['basil', 'garlic', 'olive oil', 'mozzarella', 'anchovy', 'capers',
      'oregano', 'balsamic vinegar', 'red wine', 'onion', 'thyme', 'rosemary',
      'chili', 'eggplant', 'zucchini', 'feta', 'bacon', 'egg', 'cream'],
    notes: 'A perfect balance of sweet, acid, and umami. Foundation of Mediterranean cuisine.',
  },
  {
    id: 'eggplant', name: 'Eggplant / Aubergine', category: 'Vegetable',
    flavor_profile: ['earthy', 'bitter', 'creamy when cooked'],
    pairings: ['tomato', 'garlic', 'olive oil', 'miso', 'tahini', 'yogurt', 'lamb',
      'cumin', 'coriander', 'chili', 'harissa', 'feta', 'basil', 'parmesan',
      'pomegranate', 'sesame', 'soy sauce', 'ginger'],
    notes: 'Earthy flesh transforms when roasted or charred. Absorbs strong flavors.',
  },
  {
    id: 'potato', name: 'Potato', category: 'Starch',
    flavor_profile: ['starchy', 'earthy', 'neutral'],
    pairings: ['butter', 'cream', 'garlic', 'chive', 'dill', 'rosemary', 'thyme',
      'bacon', 'cheddar', 'parmesan', 'sour cream', 'leek', 'onion', 'truffle',
      'anchovy', 'paprika', 'mustard', 'caramelised onion', 'salmon'],
    notes: 'Neutral canvas that absorbs fat and aromatics. Loves dairy and alliums.',
  },
  {
    id: 'fennel', name: 'Fennel', category: 'Vegetable',
    flavor_profile: ['anise', 'sweet', 'aromatic'],
    pairings: ['orange', 'lemon', 'salmon', 'pork', 'sausage', 'olive oil', 'parmesan',
      'cream', 'white wine', 'anise', 'apple', 'dill', 'shrimp', 'scallop',
      'tomato', 'caper', 'olive', 'pernod'],
    notes: 'Anise flavour pairs with citrus, fish, and pork. Shaves beautifully raw.',
  },
  {
    id: 'spinach', name: 'Spinach', category: 'Vegetable',
    flavor_profile: ['earthy', 'mineral', 'mild bitter'],
    pairings: ['egg', 'garlic', 'butter', 'cream', 'nutmeg', 'lemon', 'feta', 'ricotta',
      'parmesan', 'pine nuts', 'raisin', 'salmon', 'chicken', 'mushroom', 'shallot',
      'bacon', 'anchovy', 'chili'],
    notes: 'Mild iron flavour lifted by fat, acid, and nutmeg.',
  },

  // ── HERBS & AROMATICS ─────────────────────────────────────────────────────
  {
    id: 'basil', name: 'Basil', category: 'Herb',
    flavor_profile: ['sweet', 'aromatic', 'peppery', 'anise'],
    pairings: ['tomato', 'mozzarella', 'garlic', 'olive oil', 'lemon', 'pine nuts',
      'parmesan', 'balsamic vinegar', 'strawberry', 'peach', 'shrimp', 'salmon',
      'chicken', 'pasta', 'eggplant', 'zucchini', 'corn'],
    notes: 'Delicate — add at the end of cooking. Thai basil has more anise character.',
  },
  {
    id: 'rosemary', name: 'Rosemary', category: 'Herb',
    flavor_profile: ['resinous', 'pine', 'aromatic'],
    pairings: ['lamb', 'chicken', 'pork', 'beef', 'potato', 'garlic', 'lemon', 'olive oil',
      'mushroom', 'white bean', 'honey', 'orange', 'olive', 'thyme', 'anchovy'],
    notes: 'Assertive herb — use sparingly. Brilliant when infused into fats.',
  },
  {
    id: 'thyme', name: 'Thyme', category: 'Herb',
    flavor_profile: ['earthy', 'floral', 'aromatic'],
    pairings: ['chicken', 'lamb', 'beef', 'mushroom', 'tomato', 'garlic', 'lemon',
      'shallot', 'butter', 'cream', 'red wine', 'potato', 'goat cheese', 'olive oil'],
    notes: 'Workhorse herb — handles long cooking. Pairs with almost all savory proteins.',
  },
  {
    id: 'tarragon', name: 'Tarragon', category: 'Herb',
    flavor_profile: ['anise', 'sweet', 'aromatic'],
    pairings: ['chicken', 'fish', 'egg', 'cream', 'butter', 'shallot', 'white wine',
      'mustard', 'lemon', 'asparagus', 'carrot', 'mushroom', 'shrimp'],
    notes: 'Classic French herb. Central to béarnaise. Delicate — add late.',
  },
  {
    id: 'mint', name: 'Mint', category: 'Herb',
    flavor_profile: ['cool', 'sweet', 'aromatic'],
    pairings: ['lamb', 'pea', 'cucumber', 'yogurt', 'lemon', 'chocolate', 'strawberry',
      'watermelon', 'feta', 'bulgur', 'couscous', 'tomato', 'shrimp', 'mango'],
    notes: 'Cooling freshness pairs with lamb, legumes, fruit, and dairy.',
  },
  {
    id: 'dill', name: 'Dill', category: 'Herb',
    flavor_profile: ['fresh', 'anise', 'grassy'],
    pairings: ['salmon', 'cucumber', 'sour cream', 'yogurt', 'lemon', 'potato',
      'beet', 'egg', 'cream cheese', 'capers', 'shrimp', 'carrot', 'mustard'],
    notes: 'Scandinavian staple. Pairs naturally with cold-water fish.',
  },
  {
    id: 'sage', name: 'Sage', category: 'Herb',
    flavor_profile: ['earthy', 'peppery', 'aromatic', 'bitter'],
    pairings: ['butter', 'pork', 'chicken', 'duck', 'potato', 'pasta', 'pumpkin',
      'butternut squash', 'parmesan', 'onion', 'white bean', 'lemon', 'hazelnut'],
    notes: 'Robust leaf. Classic brown butter + sage with pasta, squash, or gnocchi.',
  },
  {
    id: 'garlic', name: 'Garlic', category: 'Aromatic',
    flavor_profile: ['pungent', 'savory', 'umami'],
    pairings: ['olive oil', 'lemon', 'tomato', 'mushroom', 'chicken', 'beef', 'lamb',
      'shrimp', 'pasta', 'bread', 'butter', 'thyme', 'rosemary', 'parsley',
      'chili', 'anchovy', 'ginger', 'soy sauce'],
    notes: 'Foundation of nearly all savory cooking. Sweetens dramatically when roasted.',
  },
  {
    id: 'ginger', name: 'Ginger', category: 'Aromatic / Spice',
    flavor_profile: ['spicy', 'warm', 'bright', 'aromatic'],
    pairings: ['soy sauce', 'garlic', 'sesame', 'lime', 'coconut', 'lemongrass',
      'chili', 'honey', 'orange', 'carrot', 'pumpkin', 'chicken', 'fish',
      'shrimp', 'scallop', 'pork', 'chocolate', 'pear', 'apple', 'turmeric'],
    notes: 'Bright heat works in both sweet and savory contexts.',
  },
  {
    id: 'lemongrass', name: 'Lemongrass', category: 'Aromatic',
    flavor_profile: ['citrus', 'floral', 'aromatic'],
    pairings: ['coconut', 'lime', 'ginger', 'chili', 'fish', 'shrimp', 'chicken',
      'pork', 'galangal', 'kaffir lime', 'coriander', 'mango', 'pineapple'],
    notes: 'Southeast Asian staple. Bruise to release oils. Always remove before serving.',
  },

  // ── SPICES ────────────────────────────────────────────────────────────────
  {
    id: 'cumin', name: 'Cumin', category: 'Spice',
    flavor_profile: ['earthy', 'warm', 'slightly bitter'],
    pairings: ['coriander', 'chili', 'garlic', 'onion', 'tomato', 'lemon', 'yogurt',
      'lamb', 'beef', 'chicken', 'chickpea', 'lentil', 'carrot', 'eggplant',
      'paprika', 'turmeric', 'mint', 'cilantro'],
    notes: 'Foundation spice of Middle Eastern, Indian, and Latin cuisines.',
  },
  {
    id: 'coriander', name: 'Coriander (seed)', category: 'Spice',
    flavor_profile: ['citrus', 'warm', 'floral'],
    pairings: ['cumin', 'chili', 'garlic', 'lemon', 'orange', 'ginger', 'turmeric',
      'chicken', 'lamb', 'fish', 'carrot', 'chickpea', 'yogurt'],
    notes: 'Seed has citrus brightness distinct from the leaf. Toast before grinding.',
  },
  {
    id: 'paprika', name: 'Paprika', category: 'Spice',
    flavor_profile: ['sweet', 'smoky', 'mild heat'],
    pairings: ['chicken', 'pork', 'chorizo', 'onion', 'garlic', 'tomato', 'cream',
      'sour cream', 'pepper', 'olive oil', 'potato', 'eggplant', 'mushroom'],
    notes: 'Smoked paprika adds depth. Key to romesco, paprikash, and many braises.',
  },
  {
    id: 'cinnamon', name: 'Cinnamon', category: 'Spice',
    flavor_profile: ['warm', 'sweet', 'aromatic'],
    pairings: ['apple', 'pear', 'plum', 'lamb', 'duck', 'chocolate', 'vanilla',
      'cardamom', 'clove', 'nutmeg', 'orange', 'honey', 'almond', 'rice', 'oat'],
    notes: 'Works in both sweet and savory. Key spice in Middle Eastern and North African cooking.',
  },
  {
    id: 'turmeric', name: 'Turmeric', category: 'Spice',
    flavor_profile: ['earthy', 'slightly bitter', 'warm'],
    pairings: ['coconut', 'ginger', 'coriander', 'cumin', 'chili', 'garlic', 'onion',
      'lemon', 'chicken', 'fish', 'lentil', 'cauliflower', 'rice', 'yogurt', 'black pepper'],
    notes: 'Anti-inflammatory spice. Bioavailability increased with black pepper.',
  },
  {
    id: 'saffron', name: 'Saffron', category: 'Spice',
    flavor_profile: ['floral', 'honey', 'metallic', 'earthy'],
    pairings: ['cream', 'white wine', 'lemon', 'fish', 'shrimp', 'lobster', 'chicken',
      'tomato', 'onion', 'garlic', 'rice', 'potato', 'almond', 'vanilla'],
    notes: 'Use sparingly — steep in warm liquid. Central to paella, bouillabaisse, risotto Milanese.',
  },

  // ── DAIRY & FATS ──────────────────────────────────────────────────────────
  {
    id: 'butter', name: 'Butter', category: 'Fat / Dairy',
    flavor_profile: ['rich', 'creamy', 'savory-sweet'],
    pairings: ['lemon', 'capers', 'sage', 'thyme', 'garlic', 'shallot', 'cream',
      'white wine', 'anchovy', 'mushroom', 'egg', 'vanilla', 'chocolate',
      'hazelnut', 'parmesan', 'truffle', 'miso'],
    notes: 'Universal enricher. Brown butter adds nuttiness. Beurre blanc for sauces.',
  },
  {
    id: 'cream', name: 'Cream', category: 'Dairy',
    flavor_profile: ['rich', 'fatty', 'neutral'],
    pairings: ['mushroom', 'shallot', 'white wine', 'tarragon', 'garlic', 'lemon',
      'parmesan', 'truffle', 'bacon', 'smoked salmon', 'pea', 'asparagus',
      'vanilla', 'caramel', 'chocolate', 'raspberry'],
    notes: 'Enriches and ties together flavours. Use crème fraîche for tanginess.',
  },
  {
    id: 'parmesan', name: 'Parmesan', category: 'Dairy',
    flavor_profile: ['umami', 'salty', 'nutty', 'sharp'],
    pairings: ['pasta', 'risotto', 'mushroom', 'truffle', 'tomato', 'basil', 'garlic',
      'lemon', 'egg', 'asparagus', 'cauliflower', 'pea', 'walnut', 'pine nuts'],
    notes: 'Powerful umami bomb. Rind adds depth to soups and braises.',
  },
  {
    id: 'goat-cheese', name: 'Goat Cheese', category: 'Dairy',
    flavor_profile: ['tangy', 'creamy', 'earthy'],
    pairings: ['beetroot', 'honey', 'walnut', 'fig', 'lemon', 'thyme', 'spinach',
      'asparagus', 'tomato', 'pine nuts', 'red wine', 'pear', 'apple',
      'cured meat', 'rocket', 'chive'],
    notes: 'Tangy freshness pairs with earthy vegetables and sweet elements.',
  },

  // ── ACIDS & CONDIMENTS ────────────────────────────────────────────────────
  {
    id: 'lemon', name: 'Lemon', category: 'Acid / Citrus',
    flavor_profile: ['bright', 'sour', 'aromatic'],
    pairings: ['fish', 'shrimp', 'chicken', 'veal', 'asparagus', 'artichoke', 'fennel',
      'capers', 'butter', 'cream', 'olive oil', 'garlic', 'thyme', 'dill',
      'parsley', 'vanilla', 'poppy seed', 'honey', 'ginger'],
    notes: 'Universal brightener. Use zest for aroma, juice for acidity.',
  },
  {
    id: 'balsamic', name: 'Balsamic Vinegar', category: 'Acid',
    flavor_profile: ['sweet', 'sour', 'complex'],
    pairings: ['strawberry', 'fig', 'tomato', 'mozzarella', 'beef', 'duck', 'chicken',
      'mushroom', 'beetroot', 'rocket', 'goat cheese', 'parmesan', 'olive oil',
      'red onion', 'peach', 'blackberry'],
    notes: 'Reduction intensifies sweetness. A drop finishes dishes beautifully.',
  },
  {
    id: 'miso', name: 'Miso', category: 'Condiment / Umami',
    flavor_profile: ['umami', 'salty', 'fermented', 'sweet'],
    pairings: ['butter', 'salmon', 'cod', 'chicken', 'eggplant', 'mushroom',
      'sweet potato', 'sesame', 'ginger', 'honey', 'garlic', 'soy sauce',
      'scallop', 'tahini', 'chocolate', 'caramel'],
    notes: 'White miso is sweeter. Red miso is bolder. Adds incredible depth.',
  },
  {
    id: 'soy-sauce', name: 'Soy Sauce', category: 'Condiment / Umami',
    flavor_profile: ['umami', 'salty', 'savory'],
    pairings: ['ginger', 'garlic', 'sesame', 'honey', 'lime', 'chili', 'rice vinegar',
      'chicken', 'beef', 'pork', 'salmon', 'mushroom', 'tofu', 'noodles',
      'butter', 'miso', 'orange'],
    notes: 'Foundation of Asian cooking. Tamari for gluten-free. Use to season any savory dish.',
  },
  {
    id: 'truffle', name: 'Truffle', category: 'Luxury / Umami',
    flavor_profile: ['earthy', 'umami', 'musky', 'aromatic'],
    pairings: ['egg', 'pasta', 'risotto', 'potato', 'cream', 'butter', 'parmesan',
      'mushroom', 'chicken', 'beef', 'foie gras', 'cauliflower', 'Jerusalem artichoke'],
    notes: 'Pairs best with neutral, creamy, or egg-based dishes. Avoid strong flavors.',
  },

  // ── FRUIT ─────────────────────────────────────────────────────────────────
  {
    id: 'apple', name: 'Apple', category: 'Fruit',
    flavor_profile: ['sweet', 'tart', 'crisp'],
    pairings: ['pork', 'duck', 'blue cheese', 'cheddar', 'cinnamon', 'vanilla',
      'calvados', 'walnut', 'hazelnut', 'caramel', 'sage', 'fennel', 'celery',
      'butterscotch', 'ginger'],
    notes: 'Tart varieties cut through fat. Sweeter varieties suit desserts.',
  },
  {
    id: 'orange', name: 'Orange', category: 'Fruit / Citrus',
    flavor_profile: ['sweet', 'bright', 'aromatic'],
    pairings: ['duck', 'pork', 'chicken', 'chocolate', 'almond', 'cardamom',
      'fennel', 'beet', 'carrot', 'saffron', 'cream', 'vanilla', 'rosemary',
      'brandy', 'cointreau'],
    notes: 'Zest is highly aromatic. Classic with duck in sauce bigarade.',
  },
  {
    id: 'fig', name: 'Fig', category: 'Fruit',
    flavor_profile: ['sweet', 'jammy', 'honey'],
    pairings: ['prosciutto', 'goat cheese', 'blue cheese', 'honey', 'walnut',
      'almond', 'duck', 'pork', 'red wine', 'balsamic', 'lavender',
      'vanilla', 'mascarpone', 'rocket'],
    notes: 'Sweet richness pairs with salty cured meats and tangy cheese.',
  },
  {
    id: 'mango', name: 'Mango', category: 'Fruit',
    flavor_profile: ['tropical', 'sweet', 'tart'],
    pairings: ['chili', 'lime', 'coconut', 'ginger', 'coriander', 'prawn', 'chicken',
      'jalapeño', 'mint', 'red onion', 'avocado', 'black bean', 'passion fruit'],
    notes: 'Sweet-tart tropical fruit loves chili heat and lime.',
  },
  {
    id: 'pomegranate', name: 'Pomegranate', category: 'Fruit',
    flavor_profile: ['tart', 'sweet', 'fruity'],
    pairings: ['lamb', 'duck', 'chicken', 'eggplant', 'walnut', 'mint', 'yogurt',
      'beetroot', 'sumac', 'rose water', 'pistachio', 'feta', 'radicchio'],
    notes: 'Seeds add crunch and tartness. Molasses adds deep sweet-sour notes.',
  },

  // ── NUTS & LEGUMES ────────────────────────────────────────────────────────
  {
    id: 'walnut', name: 'Walnut', category: 'Nut',
    flavor_profile: ['bitter', 'rich', 'earthy', 'oily'],
    pairings: ['blue cheese', 'beetroot', 'apple', 'pear', 'honey', 'fig', 'chocolate',
      'coffee', 'date', 'goat cheese', 'rocket', 'sage', 'red wine', 'grape'],
    notes: 'Bitter tannins pair with sweet fruit and sharp cheese.',
  },
  {
    id: 'hazelnut', name: 'Hazelnut', category: 'Nut',
    flavor_profile: ['toasty', 'sweet', 'rich'],
    pairings: ['chocolate', 'coffee', 'vanilla', 'raspberry', 'pear', 'mushroom',
      'truffle', 'asparagus', 'butter', 'cream', 'duck', 'scallop', 'cauliflower'],
    notes: 'Toast to bring out flavor. Brown butter with hazelnuts is a classic.',
  },
  {
    id: 'chickpea', name: 'Chickpea', category: 'Legume',
    flavor_profile: ['nutty', 'earthy', 'starchy'],
    pairings: ['tahini', 'lemon', 'garlic', 'cumin', 'coriander', 'paprika', 'harissa',
      'lamb', 'chicken', 'tomato', 'spinach', 'yogurt', 'olive oil', 'turmeric'],
    notes: 'Neutral legume that absorbs spice. Foundation of hummus and Middle Eastern stews.',
  },

  // ── CHOCOLATE & SWEET ─────────────────────────────────────────────────────
  {
    id: 'chocolate', name: 'Dark Chocolate', category: 'Sweet / Bitter',
    flavor_profile: ['bitter', 'rich', 'fruity', 'roasted'],
    pairings: ['raspberry', 'orange', 'coffee', 'vanilla', 'caramel', 'hazelnut',
      'walnut', 'almond', 'sea salt', 'chili', 'mint', 'cream', 'red wine',
      'miso', 'cardamom', 'cinnamon'],
    notes: 'High cocoa pairs with fruit acids and contrasting flavors. Salt intensifies.',
  },
  {
    id: 'vanilla', name: 'Vanilla', category: 'Sweet / Aromatic',
    flavor_profile: ['sweet', 'floral', 'creamy'],
    pairings: ['cream', 'egg', 'butter', 'sugar', 'caramel', 'chocolate', 'strawberry',
      'peach', 'mango', 'coconut', 'cinnamon', 'cardamom', 'rum', 'bourbon',
      'lavender', 'scallop'],
    notes: 'Enhances sweetness and rounds sharp edges. Pairs surprisingly with seafood.',
  },
  {
    id: 'caramel', name: 'Caramel', category: 'Sweet',
    flavor_profile: ['sweet', 'bitter', 'rich', 'nutty'],
    pairings: ['apple', 'pear', 'banana', 'chocolate', 'cream', 'butter', 'sea salt',
      'coffee', 'vanilla', 'walnut', 'pecan', 'whisky', 'miso'],
    notes: 'Burnt caramel bridges sweet and bitter. Salted caramel is a modern classic.',
  },

  // ── GRAINS ────────────────────────────────────────────────────────────────
  {
    id: 'risotto-rice', name: 'Risotto Rice', category: 'Grain',
    flavor_profile: ['starchy', 'creamy', 'neutral'],
    pairings: ['parmesan', 'butter', 'white wine', 'shallot', 'mushroom', 'truffle',
      'saffron', 'pea', 'asparagus', 'scallop', 'lobster', 'lemon', 'cream',
      'sage', 'blue cheese', 'beetroot'],
    notes: 'Starch creates its own sauce. Finish with cold butter and parmesan.',
  },
];

export const CATEGORIES = [...new Set(FLAVOR_PAIRINGS.map(p => p.category))].sort();

export function searchPairings(query) {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return FLAVOR_PAIRINGS.filter(
    p => p.name.toLowerCase().includes(q) ||
         p.id.includes(q) ||
         p.pairings.some(pair => pair.toLowerCase().includes(q))
  );
}

export function findById(id) {
  return FLAVOR_PAIRINGS.find(p => p.id === id);
}

export function findByName(name) {
  const n = name.toLowerCase();
  return FLAVOR_PAIRINGS.find(
    p => p.name.toLowerCase() === n || p.pairings.includes(n)
  );
}
