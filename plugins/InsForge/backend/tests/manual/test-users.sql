-- Table: test_users2
CREATE TABLE IF NOT EXISTS test_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nickname text,
    avatar_url text,
    birthday date,
    extra jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE POLICY "Enable read access for all users" ON test_users FOR SELECT TO public USING (true);
CREATE POLICY "Enable update for users based on user_id" ON test_users FOR UPDATE TO authenticated USING ((uid() = id));

-- Sample data for test_users
INSERT INTO test_users (nickname, avatar_url, birthday) VALUES 
('John Doe', 'https://example.com/avatar1.jpg', '1990-01-01'),
('Jane Smith', 'https://example.com/avatar2.jpg', '1985-05-15');