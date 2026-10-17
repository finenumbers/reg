-- Cards assembled from the syslog archive are not kept.
-- The next pass reads only bytes appended after it starts.
TRUNCATE "smg_call_traces", "smg_trace_checkpoints";
