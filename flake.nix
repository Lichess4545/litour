{
  description = "Litour development environment";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:

    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };
      in {

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # Shells
            fish

            # Python and package management
            python39
            poetry

            # Build dependencies for Python packages
            postgresql # For psycopg2 headers
            libffi # For cryptography
            libjpeg # For Pillow
            zlib # Common dependency

            # Basic dev tools
            git
            curl
            wget
            which

            # Modern CLI tools
            glow # Markdown viewer
            eza # Better ls
            fd # Better find
            bat # Better cat
            btop # Better top
            lazygit # Git TUI
            zoxide # Smart cd
            dust # Better du
            starship # Better prompt
            ripgrep # Better grep (rg command)
            sd # Better sed
            procs # Better ps
            jq # JSON processing
            yq # YAML processing
            tree # Directory visualization
          ];

          shellHook = ''
            export LD_LIBRARY_PATH="${pkgs.stdenv.cc.cc.lib}/lib:${pkgs.zlib}/lib:${pkgs.postgresql.lib}/lib:$LD_LIBRARY_PATH"
            export LIBRARY_PATH="${pkgs.stdenv.cc.cc.lib}/lib:${pkgs.zlib}/lib:${pkgs.postgresql.lib}/lib:$LIBRARY_PATH"

            # PostgreSQL client configuration
            export PGHOST=localhost
            export PGPORT=5432

            # Initialize zoxide
            eval "$(zoxide init bash)"

            # Modern tool aliases
            alias ls='eza'
            alias ll='eza -la'
            alias la='eza -a'
            alias lt='eza --tree'
            alias find='fd'
            alias cat='bat'
            alias cd='z'
            alias du='dust'
            alias ps='procs'
            alias grep='rg'
            alias sed='sd'

            echo "Litour development environment"
            echo "================================"
            echo "Python: $(python --version)"
            echo "Poetry: $(poetry --version)"
            echo ""
            echo "To get started:"
            echo "  poetry install    # Install Python dependencies"
            echo "  poetry shell      # Activate virtual environment"
            echo ""
            echo "Common commands:"
            echo "  invoke runserver  # Run Django development server"
            echo "  invoke test       # Run tests"
            echo "  invoke migrate    # Run database migrations"
            echo ""
            echo "Switch to fish shell: exec fish"
            echo "Modern CLI tools are available with aliases (ls→eza, cat→bat, etc.)"

            # Optional: auto-switch to fish shell
            # Uncomment the next line if you want to automatically enter fish shell
            # [[ $- == *i* ]] && [[ -z "$IN_NIX_SHELL_FISH" ]] && IN_NIX_SHELL_FISH=1 exec fish
          '';
        };
      });
}

