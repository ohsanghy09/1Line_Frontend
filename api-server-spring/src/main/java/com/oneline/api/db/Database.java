package com.oneline.api.db;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

/**
 * 기존 src/database.js (node:sqlite DatabaseSync) 와 같은 단일 연결 SQLite 접근.
 * 행은 열 순서를 유지하는 Map 으로, 정수/실수는 JavaScript 와 같이 Double 로 돌려준다.
 */
public final class Database implements AutoCloseable {
    private final Connection connection;

    private Database(Connection connection) {
        this.connection = connection;
    }

    /** SQLite 오류. 상태 코드가 없으므로 500으로 응답한다. */
    public static final class DatabaseError extends RuntimeException {
        public DatabaseError(SQLException cause) {
            super(cause.getMessage(), cause);
        }
    }

    // 파일 원본도 BLOB으로 보관하여 별도 파일 경로와 DB 사이의 불일치를 피한다.
    public static Database open(String path) {
        try {
            String url;
            if (path.equals(":memory:")) {
                url = "jdbc:sqlite::memory:";
            } else {
                Path file = Path.of(path).toAbsolutePath();
                if (file.getParent() != null) Files.createDirectories(file.getParent());
                url = "jdbc:sqlite:" + file;
            }
            Database db = new Database(DriverManager.getConnection(url));
            // node:sqlite 기본값과 같이 잠금 대기 없이 즉시 SQLITE_BUSY 를 반환한다.
            db.exec("PRAGMA busy_timeout = 0");
            db.exec("""
                    PRAGMA foreign_keys = ON;
                    PRAGMA journal_mode = WAL;
                    CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
                    CREATE TABLE IF NOT EXISTS analyses (
                      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, message TEXT NOT NULL,
                      reply TEXT NOT NULL, created_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS files (
                      id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL REFERENCES analyses(id),
                      name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, content BLOB NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS records (
                      id TEXT PRIMARY KEY, activity_id TEXT NOT NULL REFERENCES activities(id),
                      analysis_id TEXT UNIQUE REFERENCES analyses(id), message TEXT NOT NULL,
                      reply TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS timeline_events (
                      id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
                      change_json TEXT NOT NULL, is_turning_point INTEGER NOT NULL DEFAULT 0,
                      created_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS analysis_jobs (
                      id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL UNIQUE REFERENCES analyses(id),
                      started_at INTEGER NOT NULL, error TEXT
                    );
                    CREATE TABLE IF NOT EXISTS ai_chat_jobs (
                      id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
                      analysis_id TEXT NOT NULL UNIQUE REFERENCES analyses(id), kind TEXT NOT NULL,
                      status TEXT NOT NULL, phase TEXT NOT NULL, error TEXT, input_json TEXT NOT NULL,
                      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS journey_analyses (
                      id TEXT PRIMARY KEY, source_fingerprint TEXT NOT NULL,
                      record_count INTEGER NOT NULL, result_json TEXT NOT NULL,
                      model TEXT NOT NULL, prompt_version TEXT NOT NULL, created_at TEXT NOT NULL,
                      criteria_version TEXT
                    );
                    """);
            // 빈 기존 테이블도 지원한다. 구형 분석 행을 변환하거나 삭제하지 않는다.
            db.exec("""
                    CREATE TABLE IF NOT EXISTS internal_chat_publications (
                      job_id TEXT PRIMARY KEY REFERENCES ai_chat_jobs(id) ON DELETE CASCADE,
                      revision INTEGER NOT NULL CHECK(revision >= 1),
                      input_signature TEXT NOT NULL, publish_signature TEXT
                    );
                    CREATE TABLE IF NOT EXISTS internal_job_tombstones (
                      job_id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, analysis_id TEXT NOT NULL UNIQUE
                    );
                    """);
            boolean hasCriteria = db.all("PRAGMA table_info(journey_analyses)").stream()
                    .anyMatch(column -> "criteria_version".equals(column.get("name")));
            if (!hasCriteria) db.exec("ALTER TABLE journey_analyses ADD COLUMN criteria_version TEXT");
            Set<String> publicationColumns = new HashSet<>();
            for (var column : db.all("PRAGMA table_info(internal_chat_publications)"))
                publicationColumns.add((String) column.get("name"));
            for (String column : List.of("accepted_at_ms", "progress_received_at_ms")) {
                if (!publicationColumns.contains(column))
                    db.exec("ALTER TABLE internal_chat_publications ADD COLUMN " + column + " INTEGER");
            }
            // 기존 DB의 활동·기록·원본을 보존하며 상세 메타정보 자리만 추가한다.
            Set<String> columns = new HashSet<>();
            for (Map<String, Object> column : db.all("PRAGMA table_info(activities)")) columns.add((String) column.get("name"));
            for (String column : List.of("category", "status", "role", "period", "summary", "start_date", "end_date", "updated_at",
                    "metadata_status", "metadata_fingerprint", "metadata_error", "metadata_model", "metadata_updated_at")) {
                if (!columns.contains(column)) db.exec("ALTER TABLE activities ADD COLUMN " + column + " TEXT");
            }
            // 실행 시 예시 활동을 넣지 않는다. 활동은 실제 사용자 입력의 AI 분석으로 생성한다.
            // 과거 활동은 실제 기록 수정 시각만 이관한다. 서버 실행 시각을 최근 활동으로 만들지 않는다.
            db.exec("""
                    UPDATE activities SET updated_at = (SELECT MAX(updated_at) FROM records WHERE activity_id = activities.id)
                      WHERE updated_at IS NULL""");
            return db;
        } catch (SQLException e) {
            throw new DatabaseError(e);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    /** db.exec — 여러 문장을 순서대로 실행한다. */
    public void exec(String sql) {
        try (Statement statement = connection.createStatement()) {
            for (String part : splitStatements(sql)) statement.execute(part);
        } catch (SQLException e) {
            throw new DatabaseError(e);
        }
    }

    /** 트리거처럼 내부에 세미콜론이 있는 한 문장을 그대로 실행한다. */
    public void execStatement(String sql) {
        try (Statement statement = connection.createStatement()) {
            statement.execute(sql);
        } catch (SQLException e) {
            throw new DatabaseError(e);
        }
    }

    private static List<String> splitStatements(String sql) {
        List<String> parts = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean inString = false;
        for (int i = 0; i < sql.length(); i++) {
            char c = sql.charAt(i);
            if (c == '\'') inString = !inString;
            if (c == ';' && !inString) {
                if (!current.toString().isBlank()) parts.add(current.toString().trim());
                current.setLength(0);
            } else {
                current.append(c);
            }
        }
        if (!current.toString().isBlank()) parts.add(current.toString().trim());
        return parts;
    }

    /** prepare(sql).get(...) — 없으면 null */
    public Map<String, Object> get(String sql, Object... params) {
        List<Map<String, Object>> rows = query(sql, params, 1);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** prepare(sql).all(...) */
    public List<Map<String, Object>> all(String sql, Object... params) {
        return query(sql, params, Integer.MAX_VALUE);
    }

    /** prepare(sql).run(...) — 변경된 행 수 */
    public int run(String sql, Object... params) {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            bind(statement, params);
            statement.execute();
            return statement.getUpdateCount();
        } catch (SQLException e) {
            throw new DatabaseError(e);
        }
    }

    private List<Map<String, Object>> query(String sql, Object[] params, int limit) {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            bind(statement, params);
            List<Map<String, Object>> rows = new ArrayList<>();
            if (!statement.execute()) return rows;
            try (ResultSet resultSet = statement.getResultSet()) {
                ResultSetMetaData meta = resultSet.getMetaData();
                int count = meta.getColumnCount();
                while (rows.size() < limit && resultSet.next()) {
                    LinkedHashMap<String, Object> row = new LinkedHashMap<>();
                    for (int i = 1; i <= count; i++) {
                        Object value = resultSet.getObject(i);
                        if (value instanceof Integer n) value = n.doubleValue();
                        else if (value instanceof Long n) value = n.doubleValue();
                        else if (value instanceof Float n) value = n.doubleValue();
                        row.put(meta.getColumnLabel(i), value);
                    }
                    rows.add(row);
                }
            }
            return rows;
        } catch (SQLException e) {
            throw new DatabaseError(e);
        }
    }

    private static void bind(PreparedStatement statement, Object[] params) throws SQLException {
        for (int i = 0; i < params.length; i++) {
            Object value = params[i];
            if (value instanceof Double d && !d.isNaN() && !d.isInfinite() && Math.floor(d) == d && Math.abs(d) < 9.007199254740992E15) {
                statement.setLong(i + 1, d.longValue());
            } else if (value instanceof Boolean b) {
                statement.setLong(i + 1, b ? 1 : 0);
            } else {
                statement.setObject(i + 1, value);
            }
        }
    }

    /** 기록과 변화 이벤트는 함께 성공하거나 함께 취소한다. (BEGIN IMMEDIATE … COMMIT / ROLLBACK) */
    public <T> T transaction(Supplier<T> work) {
        exec("BEGIN IMMEDIATE");
        try {
            T result = work.get();
            exec("COMMIT");
            return result;
        } catch (RuntimeException | Error error) {
            exec("ROLLBACK");
            throw error;
        }
    }

    public void transaction(Runnable work) {
        transaction(() -> {
            work.run();
            return null;
        });
    }

    @Override
    public void close() {
        try {
            connection.close();
        } catch (SQLException e) {
            throw new DatabaseError(e);
        }
    }
}
