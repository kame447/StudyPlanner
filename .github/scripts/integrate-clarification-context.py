import subprocess

subprocess.run(
    ['git', 'fetch', 'origin', 'agent/clarification-fix-validation-base'],
    check=True,
)
script = subprocess.check_output([
    'git',
    'show',
    'origin/agent/clarification-fix-validation-base:.github/scripts/integrate-clarification-context.py',
])
compiled = compile(script, '/tmp/integrate-clarification-context.py', 'exec')
exec(compiled, {'__name__': '__main__', '__file__': '/tmp/integrate-clarification-context.py'})
