-- Insert 1500 test records into large_table
-- Using generate_series for efficient bulk insertion

INSERT INTO large_table (user_id, title, content, status, metadata, created_at, updated_at)
SELECT 
    -- Generate random user_ids from a pool of 10 different users
    (ARRAY[
        '550e8400-e29b-41d4-a716-446655440001'::uuid,
        '550e8400-e29b-41d4-a716-446655440002'::uuid,
        '550e8400-e29b-41d4-a716-446655440003'::uuid,
        '550e8400-e29b-41d4-a716-446655440004'::uuid,
        '550e8400-e29b-41d4-a716-446655440005'::uuid,
        '550e8400-e29b-41d4-a716-446655440006'::uuid,
        '550e8400-e29b-41d4-a716-446655440007'::uuid,
        '550e8400-e29b-41d4-a716-446655440008'::uuid,
        '550e8400-e29b-41d4-a716-446655440009'::uuid,
        '550e8400-e29b-41d4-a716-446655440010'::uuid
    ])[1 + floor(random() * 10)::int] as user_id,
    
    -- Generate title
    'Test Record #' || i || ' - ' || (ARRAY['Important', 'Regular', 'Draft', 'Published', 'Archived'])[1 + floor(random() * 5)::int] as title,
    
    -- Generate content with varying lengths
    'This is the content for record ' || i || '. ' || 
    repeat('Lorem ipsum dolor sit amet, consectetur adipiscing elit. ', 1 + floor(random() * 10)::int) || 
    'End of content.' as content,
    
    -- Random status
    (ARRAY['active', 'inactive', 'pending', 'completed', 'archived'])[1 + floor(random() * 5)::int] as status,
    
    -- Generate random metadata
    jsonb_build_object(
        'record_number', i,
        'category', (ARRAY['technology', 'business', 'personal', 'research', 'other'])[1 + floor(random() * 5)::int],
        'priority', floor(random() * 10 + 1)::int,
        'tags', (ARRAY['["tag1"]', '["tag1", "tag2"]', '["tag1", "tag2", "tag3"]', '["important"]', '[]'])[1 + floor(random() * 5)::int]::jsonb,
        'is_featured', (random() > 0.5),
        'view_count', floor(random() * 1000)::int,
        'test_data', true
    ) as metadata,
    
    -- Generate created_at timestamps spread over the last 90 days
    CURRENT_TIMESTAMP - (interval '1 hour' * floor(random() * 2160)) as created_at,
    
    -- Updated_at should be equal or after created_at
    CURRENT_TIMESTAMP - (interval '1 hour' * floor(random() * 720)) as updated_at
FROM generate_series(1, 1500) AS i;

-- Add some additional records with specific patterns for testing
-- Records with null content
INSERT INTO large_table (user_id, title, content, status, metadata)
VALUES 
    ('550e8400-e29b-41d4-a716-446655440001'::uuid, 'Record with null content #1', NULL, 'active', '{"special": "null_content"}'),
    ('550e8400-e29b-41d4-a716-446655440002'::uuid, 'Record with null content #2', NULL, 'inactive', '{"special": "null_content"}'),
    ('550e8400-e29b-41d4-a716-446655440003'::uuid, 'Record with null content #3', NULL, 'pending', '{"special": "null_content"}');

-- Records with very long content
INSERT INTO large_table (user_id, title, content, status, metadata)
VALUES 
    ('550e8400-e29b-41d4-a716-446655440004'::uuid, 
     'Record with very long content', 
     repeat('This is a very long text. ', 500), 
     'active', 
     '{"special": "long_content"}');

-- Records with special characters
INSERT INTO large_table (user_id, title, content, status, metadata)
VALUES 
    ('550e8400-e29b-41d4-a716-446655440005'::uuid, 
     'Record with special chars: ñ, é, ü, 中文, 🎉', 
     'Content with special characters: "quoted", ''single quotes'', backslash \, tab	character, newline
character', 
     'active', 
     '{"special": "special_chars", "unicode": "测试"}');

-- Records with complex JSON metadata
INSERT INTO large_table (user_id, title, content, status, metadata)
VALUES 
    ('550e8400-e29b-41d4-a716-446655440006'::uuid, 
     'Record with complex metadata', 
     'This record has complex nested JSON metadata', 
     'active', 
     '{
        "nested": {
            "level1": {
                "level2": {
                    "level3": "deep value"
                }
            }
        },
        "array": [1, 2, 3, 4, 5],
        "mixed": {
            "string": "text",
            "number": 123.45,
            "boolean": true,
            "null_value": null
        }
     }');

-- Summary comment
-- Total records inserted: 1506 (1500 from generate_series + 6 special test cases)