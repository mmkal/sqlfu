needs grilling!

Separate `sqlfu check` mismatch detection from action recommendation so the CLI/UI can show all mismatches without each downstream card inventing its own next step. Model recommendations explicitly, including cases where `sqlfu sync` cuts across the normal migration chain, and make card copy defer to that shared guidance instead of encoding interaction rules ad hoc.
