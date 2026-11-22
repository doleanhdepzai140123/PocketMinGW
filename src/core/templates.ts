import type { Project, Workspace } from './model';
import { newId } from './id';
export const templates: Record<string, string> = {
  'C++17 cơ bản': '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    int n;\n    cin >> n;\n    vector<long long> a(n);\n    for (auto &x : a) cin >> x;\n\n    long long sum = accumulate(a.begin(), a.end(), 0LL);\n    cout << sum << \'\\n\';\n    return 0;\n}\n',
  'Đọc / ghi file': '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    freopen("BAI.INP", "r", stdin);\n    freopen("BAI.OUT", "w", stdout);\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    long long a, b;\n    cin >> a >> b;\n    cout << a + b << \'\\n\';\n    return 0;\n}\n',
  'Tìm kiếm nhị phân': '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    int n, target;\n    cin >> n >> target;\n    vector<int> a(n);\n    for (int &x : a) cin >> x;\n    sort(a.begin(), a.end());\n    auto it = lower_bound(a.begin(), a.end(), target);\n    cout << (it != a.end() && *it == target ? it - a.begin() : -1) << \'\\n\';\n}\n',
};
export function newProject(name: string, template = 'C++17 cơ bản'): Project {
  const isFile = template === 'Đọc / ghi file';
  return { id: newId(), name, files: [{ path: 'main.cpp', content: templates[template] ?? templates['C++17 cơ bản'] }], tabs: ['main.cpp'], active: 'main.cpp', stdin: isFile ? '12 30\n' : '5\n1 2 3 4 5\n', tests: [{ id: newId(), name: 'Ví dụ 1', input: isFile ? '12 30\n' : '5\n1 2 3 4 5\n', expected: isFile ? '42\n' : '15\n' }], inputFile: isFile ? 'BAI.INP' : '', outputFile: isFile ? 'BAI.OUT' : '', timeLimitMs: 3000 };
}
export function initialWorkspace(): Workspace { const p = newProject('Tổng dãy số'); return { version: 1, projects: [p], activeProject: p.id, fontSize: 16, wrap: false }; }
