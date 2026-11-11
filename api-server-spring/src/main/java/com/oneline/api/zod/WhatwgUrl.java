package com.oneline.api.zod;

import com.ibm.icu.text.IDNA;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Node 의 new URL() / URL.canParse() (WHATWG URL Standard) 판정을 따르는 파서.
 * 링크 검증에 필요한 protocol·username·password·hostname 만 계산한다.
 */
public final class WhatwgUrl {
    public final String protocol;
    public final String username;
    public final String password;
    public final String hostname;

    private WhatwgUrl(String protocol, String username, String password, String hostname) {
        this.protocol = protocol;
        this.username = username;
        this.password = password;
        this.hostname = hostname;
    }

    private static final Set<String> SPECIAL = Set.of("http", "https", "ws", "wss", "ftp", "file");
    private static final IDNA UTS46 = IDNA.getUTS46Instance(IDNA.CHECK_BIDI | IDNA.CHECK_CONTEXTJ
            | IDNA.NONTRANSITIONAL_TO_ASCII | IDNA.NONTRANSITIONAL_TO_UNICODE);

    /** 파싱 실패 시 null */
    public static WhatwgUrl parse(String raw) {
        try {
            return parseOrThrow(raw);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static WhatwgUrl parseOrThrow(String raw) {
        int start = 0, end = raw.length();
        while (start < end && raw.charAt(start) <= 0x20) start++;
        while (end > start && raw.charAt(end - 1) <= 0x20) end--;
        String input = raw.substring(start, end).replaceAll("[\\t\\n\\r]", "");

        if (input.isEmpty() || !isAsciiAlpha(input.charAt(0))) return null;
        int colon = -1;
        for (int i = 1; i < input.length(); i++) {
            char c = input.charAt(i);
            if (c == ':') {
                colon = i;
                break;
            }
            if (!(isAsciiAlpha(c) || (c >= '0' && c <= '9') || c == '+' || c == '-' || c == '.')) return null;
        }
        if (colon < 0) return null;
        String scheme = input.substring(0, colon).toLowerCase(Locale.ROOT);
        String rest = input.substring(colon + 1);
        String protocol = scheme + ":";

        if (SPECIAL.contains(scheme)) {
            if (scheme.equals("file")) {
                // file URL 은 호스트가 비어도 유효하다. 호스트가 있으면 같은 규칙으로 검사한다.
                String after = rest.replace('\\', '/');
                if (after.startsWith("//")) {
                    String authority = cutAuthority(after.substring(2));
                    if (!authority.isEmpty() && !isWindowsDriveLetter(authority)) {
                        String host = parseHost(authority, true);
                        if (host.equals("localhost")) host = "";
                        return new WhatwgUrl(protocol, "", "", host);
                    }
                }
                return new WhatwgUrl(protocol, "", "", "");
            }
            int i = 0;
            while (i < rest.length() && (rest.charAt(i) == '/' || rest.charAt(i) == '\\')) i++;
            String authority = cutAuthority(rest.substring(i), true);
            return parseAuthority(protocol, authority, true);
        }

        if (rest.startsWith("//")) {
            String authority = cutAuthority(rest.substring(2), false);
            return parseAuthority(protocol, authority, false);
        }
        return new WhatwgUrl(protocol, "", "", "");
    }

    private static String cutAuthority(String value) {
        return cutAuthority(value, true);
    }

    private static String cutAuthority(String value, boolean special) {
        int i = 0;
        while (i < value.length()) {
            char c = value.charAt(i);
            if (c == '/' || c == '?' || c == '#' || (special && c == '\\')) break;
            i++;
        }
        return value.substring(0, i);
    }

    private static WhatwgUrl parseAuthority(String protocol, String authority, boolean special) {
        String username = "", password = "";
        int at = authority.lastIndexOf('@');
        String hostPort = authority;
        if (at >= 0) {
            String userinfo = authority.substring(0, at);
            hostPort = authority.substring(at + 1);
            int colon = userinfo.indexOf(':');
            username = colon >= 0 ? userinfo.substring(0, colon) : userinfo;
            password = colon >= 0 ? userinfo.substring(colon + 1) : "";
            if (hostPort.isEmpty()) throw new IllegalArgumentException("host missing");
        }
        String host = hostPort, port = "";
        int colon = -1;
        boolean inBrackets = false;
        for (int i = 0; i < hostPort.length(); i++) {
            char c = hostPort.charAt(i);
            if (c == '[') inBrackets = true;
            else if (c == ']') inBrackets = false;
            else if (c == ':' && !inBrackets) {
                colon = i;
                break;
            }
        }
        if (colon >= 0) {
            host = hostPort.substring(0, colon);
            port = hostPort.substring(colon + 1);
            if (host.isEmpty()) throw new IllegalArgumentException("host missing");
        }
        if (special && host.isEmpty()) throw new IllegalArgumentException("host missing");
        for (int i = 0; i < port.length(); i++) {
            char c = port.charAt(i);
            if (c < '0' || c > '9') throw new IllegalArgumentException("port");
        }
        if (!port.isEmpty()) {
            String digits = port.replaceFirst("^0+(?=.)", "");
            if (digits.length() > 5 || Integer.parseInt(digits) > 65535) throw new IllegalArgumentException("port");
        }
        String hostname = host.isEmpty() ? "" : parseHost(host, special);
        return new WhatwgUrl(protocol, username, password, hostname);
    }

    private static boolean isWindowsDriveLetter(String value) {
        return value.length() == 2 && isAsciiAlpha(value.charAt(0)) && (value.charAt(1) == ':' || value.charAt(1) == '|');
    }

    private static String parseHost(String input, boolean special) {
        if (input.startsWith("[")) {
            if (!input.endsWith("]")) throw new IllegalArgumentException("ipv6");
            if (!validIpv6(input.substring(1, input.length() - 1))) throw new IllegalArgumentException("ipv6");
            return input.toLowerCase(Locale.ROOT);
        }
        if (!special) {
            for (int i = 0; i < input.length(); i++) {
                if (isForbiddenHost(input.charAt(i))) throw new IllegalArgumentException("opaque host");
            }
            return input;
        }
        String domain = percentDecode(input);
        StringBuilder ascii = new StringBuilder();
        IDNA.Info info = new IDNA.Info();
        UTS46.nameToASCII(domain, ascii, info);
        for (IDNA.Error error : info.getErrors()) {
            switch (error) {
                case LEADING_HYPHEN, TRAILING_HYPHEN, HYPHEN_3_4, EMPTY_LABEL, LABEL_TOO_LONG, DOMAIN_NAME_TOO_LONG -> {
                }
                default -> throw new IllegalArgumentException("idna");
            }
        }
        String result = ascii.toString();
        if (result.isEmpty()) throw new IllegalArgumentException("empty host");
        for (int i = 0; i < result.length(); i++) {
            char c = result.charAt(i);
            if (isForbiddenHost(c) || c == '%' || c <= 0x1F || c == 0x7F) throw new IllegalArgumentException("forbidden");
        }
        if (endsInNumber(result)) parseIpv4(result);
        return result;
    }

    private static boolean isForbiddenHost(char c) {
        return c == 0 || c == '\t' || c == '\n' || c == '\r' || c == ' ' || c == '#' || c == '/' || c == ':' || c == '<'
                || c == '>' || c == '?' || c == '@' || c == '[' || c == '\\' || c == ']' || c == '^' || c == '|';
    }

    private static String percentDecode(String input) {
        byte[] bytes = input.getBytes(StandardCharsets.UTF_8);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (int i = 0; i < bytes.length; i++) {
            byte b = bytes[i];
            if (b == '%' && i + 2 < bytes.length && hex(bytes[i + 1]) >= 0 && hex(bytes[i + 2]) >= 0) {
                out.write(hex(bytes[i + 1]) * 16 + hex(bytes[i + 2]));
                i += 2;
            } else {
                out.write(b);
            }
        }
        return out.toString(StandardCharsets.UTF_8);
    }

    private static int hex(byte b) {
        return Character.digit((char) b, 16);
    }

    private static boolean endsInNumber(String host) {
        List<String> parts = new ArrayList<>(List.of(host.split("\\.", -1)));
        if (parts.get(parts.size() - 1).isEmpty()) {
            if (parts.size() == 1) return false;
            parts.remove(parts.size() - 1);
        }
        String last = parts.get(parts.size() - 1);
        if (!last.isEmpty() && last.chars().allMatch(c -> c >= '0' && c <= '9')) return true;
        return parseIpv4Number(last) != null;
    }

    private static void parseIpv4(String host) {
        List<String> parts = new ArrayList<>(List.of(host.split("\\.", -1)));
        if (parts.get(parts.size() - 1).isEmpty() && parts.size() > 1) parts.remove(parts.size() - 1);
        if (parts.size() > 4) throw new IllegalArgumentException("ipv4");
        List<Long> numbers = new ArrayList<>();
        for (String part : parts) {
            Long number = parseIpv4Number(part);
            if (number == null) throw new IllegalArgumentException("ipv4");
            numbers.add(number);
        }
        for (int i = 0; i < numbers.size() - 1; i++) {
            if (numbers.get(i) > 255) throw new IllegalArgumentException("ipv4");
        }
        if (numbers.get(numbers.size() - 1) >= Math.pow(256, 5 - numbers.size())) throw new IllegalArgumentException("ipv4");
    }

    private static Long parseIpv4Number(String input) {
        if (input.isEmpty()) return null;
        int radix = 10;
        String digits = input;
        if (digits.length() >= 2 && (digits.startsWith("0x") || digits.startsWith("0X"))) {
            digits = digits.substring(2);
            radix = 16;
        } else if (digits.length() >= 2 && digits.startsWith("0")) {
            digits = digits.substring(1);
            radix = 8;
        }
        if (digits.isEmpty()) return 0L;
        for (int i = 0; i < digits.length(); i++) {
            if (Character.digit(digits.charAt(i), radix) < 0) return null;
        }
        try {
            return digits.length() > 15 ? Long.MAX_VALUE : Long.parseLong(digits, radix);
        } catch (NumberFormatException e) {
            return Long.MAX_VALUE;
        }
    }

    private static boolean validIpv6(String value) {
        if (value.isEmpty()) return false;
        int doubleColon = value.indexOf("::");
        if (doubleColon >= 0 && value.indexOf("::", doubleColon + 1) >= 0) return false;
        String[] halves = doubleColon >= 0
                ? new String[]{value.substring(0, doubleColon), value.substring(doubleColon + 2)}
                : new String[]{value};
        int groups = 0;
        for (int h = 0; h < halves.length; h++) {
            String half = halves[h];
            if (half.isEmpty()) continue;
            String[] parts = half.split(":", -1);
            for (int i = 0; i < parts.length; i++) {
                String part = parts[i];
                boolean last = h == halves.length - 1 && i == parts.length - 1;
                if (last && part.contains(".")) {
                    String[] octets = part.split("\\.", -1);
                    if (octets.length != 4) return false;
                    for (String octet : octets) {
                        if (octet.isEmpty() || octet.length() > 3 || !octet.chars().allMatch(Character::isDigit)) return false;
                        if (octet.length() > 1 && octet.startsWith("0")) return false;
                        if (Integer.parseInt(octet) > 255) return false;
                    }
                    groups += 2;
                    continue;
                }
                if (part.isEmpty() || part.length() > 4) return false;
                for (int k = 0; k < part.length(); k++) {
                    if (Character.digit(part.charAt(k), 16) < 0) return false;
                }
                groups++;
            }
        }
        return doubleColon >= 0 ? groups <= 7 : groups == 8;
    }

    private static boolean isAsciiAlpha(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
    }
}
