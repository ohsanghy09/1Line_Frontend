package com.oneline.api.service;

import com.ibm.icu.text.Collator;
import com.ibm.icu.util.ULocale;
import com.oneline.api.db.Database;
import com.oneline.api.js.Js;
import com.oneline.api.js.Json;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

import static com.oneline.api.js.Js.obj;

/** 기존 src/archive-search.js */
public final class ArchiveSearch {
    private ArchiveSearch() {
    }

    private static String normalize(Object value) {
        String text = Js.requireString(value, "normalize");
        return Js.toLowerCase(Js.collapseWhitespace(Js.trim(Normalizer.normalize(text, Normalizer.Form.NFC))));
    }

    // 개발 서버에서 저장된 텍스트만 비교한다. 파일 원본 BLOB을 읽거나 본문을 추출하지 않는다.
    static List<LinkedHashMap<String, Object>> selectArchiveActivities(List<LinkedHashMap<String, Object>> activities,
                                                                       String search, Object category, Object status, Object sort) {
        String query = normalize(search);
        List<LinkedHashMap<String, Object>> result = new ArrayList<>();
        for (LinkedHashMap<String, Object> activity : activities) {
            if (!(Js.strictEquals(category, "all") || Js.strictEquals(activity.get("category"), category))) continue;
            if (!(Js.strictEquals(status, "all") || Js.strictEquals(activity.get("status"), status))) continue;
            if (!query.isEmpty()) {
                boolean found = false;
                for (Object value : Js.asArray(activity.get("searchTexts"))) {
                    if (normalize(value).contains(query)) {
                        found = true;
                        break;
                    }
                }
                if (!found) continue;
            }
            result.add(activity);
        }
        // JavaScript 비교 함수와 같이 양수면 b 를 앞에 둔다.
        result.sort((a, b) -> {
            double value;
            if (Js.strictEquals(sort, "materials")) {
                value = ((Number) b.get("materialsCount")).doubleValue() - ((Number) a.get("materialsCount")).doubleValue();
            } else {
                double difference = zeroIfNaN(Js.parseDate(b.get("updatedAt"))) - zeroIfNaN(Js.parseDate(a.get("updatedAt")));
                value = Js.strictEquals(sort, "oldest") ? -difference : difference;
            }
            return value > 0 ? 1 : value < 0 ? -1 : 0;
        });
        return result;
    }

    private static double zeroIfNaN(double value) {
        return Double.isNaN(value) ? 0 : value;
    }

    public static LinkedHashMap<String, Object> searchArchive(Database db, Map<String, Object> query) {
        List<LinkedHashMap<String, Object>> activities = new ArrayList<>();
        for (Map<String, Object> row : db.all("SELECT id, name, summary FROM activities ORDER BY rowid")) {
            LinkedHashMap<String, Object> archive = Archive.readArchive(db, row.get("id"));
            List<Map<String, Object>> files = Archive.allFiles(archive);
            LinkedHashMap<String, Object> activity = new LinkedHashMap<>(archive);
            activity.remove("folders");
            activity.remove("timeline");
            // 텍스트 경험 기록은 자료 폴더에는 넣지 않지만 확정 기록 검색과 분석에서는 보존한다.
            List<Object> savedTexts = new ArrayList<>();
            for (Map<String, Object> record : db.all("""
                    SELECT r.message, r.reply,
                          EXISTS(SELECT 1 FROM files f WHERE f.analysis_id = r.analysis_id) AS has_files
                          FROM records r WHERE r.activity_id = ?""", row.get("id"))) {
                Object reply = Json.parse((String) record.get("reply"));
                // 기존 자료에 남은 입력 글도 자료 검색에 사용하지 않는다. 독립 텍스트 경험은 유지한다.
                savedTexts.add(Js.truthy(record.get("has_files")) || Js.truthy(Js.get(reply, "sourceUrl")) ? "" : record.get("message"));
                savedTexts.add(Js.coalesce(Js.opt(Js.get(reply, "analysis"), "summary"), ""));
            }
            // 미저장 분석은 readArchive에 포함되지 않는다. 전체 자료 수는 검색으로 줄이지 않는다.
            List<Object> searchTexts = new ArrayList<>();
            searchTexts.add(row.get("name"));
            searchTexts.add(Js.coalesce(row.get("summary"), ""));
            searchTexts.addAll(savedTexts);
            for (Map<String, Object> file : files) {
                searchTexts.add(file.get("name"));
                searchTexts.add(file.get("summary"));
            }
            activity.put("searchTexts", searchTexts);
            activities.add(activity);
        }
        List<Object> items = new ArrayList<>();
        for (LinkedHashMap<String, Object> activity : selectArchiveActivities(activities, (String) query.get("q"),
                query.get("category"), query.get("status"), query.get("sort"))) {
            LinkedHashMap<String, Object> item = new LinkedHashMap<>(activity);
            item.remove("searchTexts");
            items.add(item);
        }
        // 검색·유형·상태 조건과 무관한 전체 유형을 반환해 필터 선택지를 유지한다.
        LinkedHashSet<Object> unique = new LinkedHashSet<>();
        List<Object> categories = new ArrayList<>();
        for (LinkedHashMap<String, Object> activity : activities) {
            Object category = activity.get("category");
            if (unique.add(Js.setKey(category))) categories.add(category);
        }
        Collator collator = Collator.getInstance(ULocale.forLanguageTag("ko"));
        categories.sort((a, b) -> collator.compare(Js.str(a), Js.str(b)));
        return obj("items", items, "total", (double) activities.size(), "categories", categories);
    }
}
