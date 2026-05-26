-- Allow 'math' as a test_type
ALTER TABLE reading_history DROP CONSTRAINT IF EXISTS reading_history_test_type_check;
ALTER TABLE reading_history ADD CONSTRAINT reading_history_test_type_check
  CHECK (test_type IN ('speed', 'voice', 'math'));
