UPDATE `products`
SET
  `price` = CASE `code`
    WHEN 'gita1' THEN 501
    WHEN 'gita2' THEN 251
    WHEN 'upasana' THEN 251
    WHEN 'nithya' THEN 251
    ELSE `price`
  END,
  `name` = CASE `code`
    WHEN 'upasana' THEN 'Upasana'
    WHEN 'nithya' THEN 'Nityaniyam'
    ELSE `name`
  END,
  `short_name` = CASE `code`
    WHEN 'upasana' THEN 'Upasana'
    WHEN 'nithya' THEN 'Nityaniyam'
    ELSE `short_name`
  END
WHERE `code` IN ('gita1', 'gita2', 'upasana', 'nithya');