-- Add indexes
CREATE INDEX IF NOT EXISTS idx_large_table_user_id ON large_table(user_id);
CREATE INDEX IF NOT EXISTS idx_large_table_created_at ON large_table(created_at);
CREATE INDEX IF NOT EXISTS idx_large_table_status ON large_table(status);

-- Create trigger function for updating updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_large_table_updated_at ON large_table;
CREATE TRIGGER update_large_table_updated_at 
    BEFORE UPDATE ON large_table
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE large_table ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
DROP POLICY IF EXISTS "Enable read access for all users" ON large_table;
CREATE POLICY "Enable read access for all users" 
    ON large_table 
    FOR SELECT 
    USING (true);

-- Grant permissions
GRANT ALL ON large_table TO anon;
GRANT ALL ON large_table TO authenticated;